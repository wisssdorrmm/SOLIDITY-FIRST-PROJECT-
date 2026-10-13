const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const Reason = { BadNafdacNumber: 0, PackagingMismatch: 1, Expired: 2, NoEffect: 3, Other: 4 };
const Status = { Pending: 0, Confirmed: 1, Rejected: 2 };
const Risk = { None: 0, Suspected: 1, ConfirmedFake: 2 };

const id = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const BATCH = id("A4-0000|BN1234");
const PHARMACY = id("good health pharmacy|idumota, lagos");
let photoNonce = 0;
const photo = () => id(`photo-${photoNonce++}`);

describe("DrugReportRegistry", function () {
  async function deploy() {
    const [owner, reviewer, alice, bob, carol, relayer] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory("DrugReportRegistry")).deploy();
    await registry.setReviewer(reviewer.address, true);
    return { registry, owner, reviewer, alice, bob, carol, relayer };
  }

  async function report(registry, signer, opts = {}) {
    return registry
      .connect(signer)
      .submitReport(
        opts.batch ?? BATCH,
        opts.pharmacy ?? PHARMACY,
        opts.photo ?? photo(),
        opts.reason ?? Reason.PackagingMismatch,
        opts.drug ?? "Coartem 80/480",
        opts.area ?? "Idumota, Lagos"
      );
  }

  describe("submitReport", function () {
    it("stores the report and updates batch and pharmacy stats", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await expect(report(registry, alice))
        .to.emit(registry, "ReportSubmitted")
        .withArgs(0, BATCH, PHARMACY, alice.address, Reason.PackagingMismatch, "Coartem 80/480", "Idumota, Lagos");

      const r = await registry.getReport(0);
      expect(r.submitter).to.equal(alice.address);
      expect(r.status).to.equal(Status.Pending);

      const [stats, risk, ids] = await registry.getBatch(BATCH);
      expect(stats.pending).to.equal(1);
      expect(risk).to.equal(Risk.None);
      expect(ids).to.deep.equal([0n]);
      expect((await registry.getPharmacy(PHARMACY)).reports).to.equal(1);
    });

    it("rejects empty batch keys and photo hashes", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await expect(report(registry, alice, { batch: ethers.ZeroHash })).to.be.revertedWithCustomError(registry, "EmptyBatchKey");
      await expect(report(registry, alice, { photo: ethers.ZeroHash })).to.be.revertedWithCustomError(registry, "EmptyPhotoHash");
    });

    it("rejects the same photo twice", async function () {
      const { registry, alice, bob } = await loadFixture(deploy);
      const p = photo();
      await report(registry, alice, { photo: p });
      await expect(report(registry, bob, { photo: p })).to.be.revertedWithCustomError(registry, "PhotoAlreadyReported");
    });

    it("rejects overly long text", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await expect(report(registry, alice, { drug: "x".repeat(97) })).to.be.revertedWithCustomError(registry, "TextTooLong");
    });

    it("enforces a per-address cooldown", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await report(registry, alice);
      await expect(report(registry, alice)).to.be.revertedWithCustomError(registry, "CooldownActive");
      await time.increase(60);
      await expect(report(registry, alice)).to.emit(registry, "ReportSubmitted");
    });

    it("exempts relayers from the cooldown", async function () {
      const { registry, relayer } = await loadFixture(deploy);
      await registry.setRelayer(relayer.address, true);
      await report(registry, relayer);
      await expect(report(registry, relayer)).to.emit(registry, "ReportSubmitted");
    });

    it("allows reports without a pharmacy", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await report(registry, alice, { pharmacy: ethers.ZeroHash });
      expect((await registry.getPharmacy(ethers.ZeroHash)).reports).to.equal(0);
    });
  });

  describe("risk", function () {
    it("marks a batch Suspected once enough pending reports arrive", async function () {
      const { registry, alice, bob, carol } = await loadFixture(deploy);
      await report(registry, alice);
      await report(registry, bob);
      await expect(report(registry, carol)).to.emit(registry, "BatchRiskChanged").withArgs(BATCH, Risk.Suspected);
      expect(await registry.batchRisk(BATCH)).to.equal(Risk.Suspected);
    });

    it("marks a batch ConfirmedFake when a reviewer confirms", async function () {
      const { registry, reviewer, alice } = await loadFixture(deploy);
      await report(registry, alice);
      await expect(registry.connect(reviewer).reviewReport(0, Status.Confirmed))
        .to.emit(registry, "BatchRiskChanged")
        .withArgs(BATCH, Risk.ConfirmedFake);
      const [stats] = await registry.getBatch(BATCH);
      expect(stats.pending).to.equal(0);
      expect(stats.confirmed).to.equal(1);
      expect((await registry.getPharmacy(PHARMACY)).confirmedFakes).to.equal(1);
    });

    it("drops back to None when suspicious reports are rejected", async function () {
      const { registry, reviewer, alice, bob, carol } = await loadFixture(deploy);
      await report(registry, alice);
      await report(registry, bob);
      await report(registry, carol);
      await expect(registry.connect(reviewer).reviewReport(0, Status.Rejected))
        .to.emit(registry, "BatchRiskChanged")
        .withArgs(BATCH, Risk.None);
      const [stats] = await registry.getBatch(BATCH);
      expect(stats.rejected).to.equal(1);
      expect(stats.pending).to.equal(2);
    });

    it("keeps other batches unaffected", async function () {
      const { registry, reviewer, alice } = await loadFixture(deploy);
      await report(registry, alice);
      await registry.connect(reviewer).reviewReport(0, Status.Confirmed);
      expect(await registry.batchRisk(id("A4-9999|OTHER"))).to.equal(Risk.None);
    });
  });

  describe("reviewReport", function () {
    it("only lets reviewers review", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await report(registry, alice);
      await expect(registry.connect(alice).reviewReport(0, Status.Confirmed)).to.be.revertedWithCustomError(registry, "NotReviewer");
    });

    it("cannot review twice, set Pending, or review unknown ids", async function () {
      const { registry, reviewer, alice } = await loadFixture(deploy);
      await report(registry, alice);
      await expect(registry.connect(reviewer).reviewReport(0, Status.Pending)).to.be.revertedWithCustomError(registry, "InvalidStatus");
      await registry.connect(reviewer).reviewReport(0, Status.Rejected);
      await expect(registry.connect(reviewer).reviewReport(0, Status.Confirmed)).to.be.revertedWithCustomError(registry, "AlreadyReviewed");
      await expect(registry.connect(reviewer).reviewReport(5, Status.Confirmed)).to.be.revertedWithCustomError(registry, "UnknownReport");
    });

    it("does not count rejected reports against the pharmacy", async function () {
      const { registry, reviewer, alice } = await loadFixture(deploy);
      await report(registry, alice);
      await registry.connect(reviewer).reviewReport(0, Status.Rejected);
      const p = await registry.getPharmacy(PHARMACY);
      expect(p.reports).to.equal(1);
      expect(p.confirmedFakes).to.equal(0);
    });
  });

  describe("getRecentReports", function () {
    it("pages newest first", async function () {
      const { registry, alice, bob, carol } = await loadFixture(deploy);
      await report(registry, alice, { drug: "a" });
      await report(registry, bob, { drug: "b" });
      await report(registry, carol, { drug: "c" });

      const [page, ids] = await registry.getRecentReports(0, 2);
      expect(ids).to.deep.equal([2n, 1n]);
      expect(page.map((r) => r.drugName)).to.deep.equal(["c", "b"]);

      const [page2, ids2] = await registry.getRecentReports(2, 10);
      expect(ids2).to.deep.equal([0n]);
      expect(page2[0].drugName).to.equal("a");

      const [empty] = await registry.getRecentReports(3, 10);
      expect(empty.length).to.equal(0);
    });
  });

  describe("admin", function () {
    it("restricts admin functions to the owner", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await expect(registry.connect(alice).setReviewer(alice.address, true)).to.be.revertedWithCustomError(registry, "NotOwner");
      await expect(registry.connect(alice).setRelayer(alice.address, true)).to.be.revertedWithCustomError(registry, "NotOwner");
      await expect(registry.connect(alice).setThresholds(2, 5, 0)).to.be.revertedWithCustomError(registry, "NotOwner");
      await expect(registry.connect(alice).transferOwnership(alice.address)).to.be.revertedWithCustomError(registry, "NotOwner");
    });

    it("updates thresholds and validates them", async function () {
      const { registry, reviewer, alice } = await loadFixture(deploy);
      await expect(registry.setThresholds(0, 3, 60)).to.be.revertedWithCustomError(registry, "InvalidThreshold");
      await registry.setThresholds(2, 5, 0);
      await report(registry, alice);
      await registry.connect(reviewer).reviewReport(0, Status.Confirmed);
      expect(await registry.batchRisk(BATCH)).to.equal(Risk.None); // needs 2 confirmations now
    });

    it("transfers ownership", async function () {
      const { registry, alice } = await loadFixture(deploy);
      await expect(registry.transferOwnership(ethers.ZeroAddress)).to.be.revertedWithCustomError(registry, "ZeroAddress");
      await registry.transferOwnership(alice.address);
      expect(await registry.owner()).to.equal(alice.address);
    });
  });
});
