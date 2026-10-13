// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title DrugReportRegistry
/// @notice Public, tamper-proof record of suspected fake medicine reports.
/// Anyone can report a suspicious pack; reviewers (pharmacists, NGO staff)
/// confirm or reject reports. Batch and pharmacy risk is derived from the
/// reviewed history, so nobody can quietly delete or bribe away a report.
/// @dev Photos and personal data stay off-chain; only hashes are stored.
contract DrugReportRegistry {
    enum Reason {
        BadNafdacNumber, // number missing, malformed, or not in the NAFDAC register
        PackagingMismatch, // print, colour, logo or spelling differs from the genuine pack
        Expired, // expired, or dates look tampered with
        NoEffect, // patient reports the drug did not work
        Other
    }

    enum Status {
        Pending,
        Confirmed,
        Rejected
    }

    enum Risk {
        None,
        Suspected, // enough unreviewed reports to warn people
        ConfirmedFake // at least `confirmThreshold` reports confirmed by reviewers
    }

    struct Report {
        bytes32 batchKey; // keccak256 of normalised "NAFDACNO|BATCHNO"
        bytes32 pharmacyId; // keccak256 of normalised pharmacy name + area, or 0
        bytes32 photoHash; // sha256 of the evidence photo (photo stays off-chain)
        address submitter;
        uint64 createdAt;
        Reason reason;
        Status status;
        string drugName;
        string area; // e.g. "Idumota, Lagos"
    }

    struct BatchStats {
        uint32 pending;
        uint32 confirmed;
        uint32 rejected;
    }

    struct PharmacyStats {
        uint32 reports;
        uint32 confirmedFakes;
    }

    uint256 public constant MAX_TEXT_LENGTH = 96;

    address public owner;
    uint32 public confirmThreshold = 1;
    uint32 public suspicionThreshold = 3;
    uint64 public submitCooldown = 1 minutes;

    mapping(address => bool) public isReviewer;
    /// Relayers submit on behalf of users without wallets (e.g. USSD, web app)
    /// and are exempt from the per-address cooldown; they rate-limit off-chain.
    mapping(address => bool) public isRelayer;

    Report[] private _reports;
    mapping(bytes32 => uint256[]) private _reportsByBatch;
    mapping(bytes32 => BatchStats) private _batchStats;
    mapping(bytes32 => PharmacyStats) private _pharmacyStats;
    mapping(bytes32 => bool) public photoUsed;
    mapping(address => uint64) public lastSubmitAt;

    event ReportSubmitted(
        uint256 indexed reportId,
        bytes32 indexed batchKey,
        bytes32 indexed pharmacyId,
        address submitter,
        Reason reason,
        string drugName,
        string area
    );
    event ReportReviewed(uint256 indexed reportId, bytes32 indexed batchKey, address indexed reviewer, Status status);
    event BatchRiskChanged(bytes32 indexed batchKey, Risk risk);
    event ReviewerSet(address indexed account, bool allowed);
    event RelayerSet(address indexed account, bool allowed);
    event ThresholdsSet(uint32 confirmThreshold, uint32 suspicionThreshold, uint64 submitCooldown);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    error NotOwner();
    error NotReviewer();
    error EmptyBatchKey();
    error EmptyPhotoHash();
    error PhotoAlreadyReported();
    error TextTooLong();
    error CooldownActive(uint64 availableAt);
    error UnknownReport();
    error AlreadyReviewed();
    error InvalidStatus();
    error InvalidThreshold();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyReviewer() {
        if (!isReviewer[msg.sender]) revert NotReviewer();
        _;
    }

    constructor() {
        owner = msg.sender;
        isReviewer[msg.sender] = true;
        emit OwnershipTransferred(address(0), msg.sender);
        emit ReviewerSet(msg.sender, true);
    }

    // ---------------------------------------------------------------------
    // Reporting
    // ---------------------------------------------------------------------

    function submitReport(
        bytes32 batchKey,
        bytes32 pharmacyId,
        bytes32 photoHash,
        Reason reason,
        string calldata drugName,
        string calldata area
    ) external returns (uint256 reportId) {
        if (batchKey == bytes32(0)) revert EmptyBatchKey();
        if (photoHash == bytes32(0)) revert EmptyPhotoHash();
        if (photoUsed[photoHash]) revert PhotoAlreadyReported();
        if (bytes(drugName).length > MAX_TEXT_LENGTH || bytes(area).length > MAX_TEXT_LENGTH) revert TextTooLong();

        if (!isRelayer[msg.sender]) {
            uint64 last = lastSubmitAt[msg.sender];
            if (last != 0 && block.timestamp < last + submitCooldown) revert CooldownActive(last + submitCooldown);
            lastSubmitAt[msg.sender] = uint64(block.timestamp);
        }

        Risk before = batchRisk(batchKey);

        photoUsed[photoHash] = true;
        reportId = _reports.length;
        _reports.push(
            Report({
                batchKey: batchKey,
                pharmacyId: pharmacyId,
                photoHash: photoHash,
                submitter: msg.sender,
                createdAt: uint64(block.timestamp),
                reason: reason,
                status: Status.Pending,
                drugName: drugName,
                area: area
            })
        );
        _reportsByBatch[batchKey].push(reportId);
        _batchStats[batchKey].pending += 1;
        if (pharmacyId != bytes32(0)) _pharmacyStats[pharmacyId].reports += 1;

        emit ReportSubmitted(reportId, batchKey, pharmacyId, msg.sender, reason, drugName, area);
        _emitRiskChange(batchKey, before);
    }

    // ---------------------------------------------------------------------
    // Review
    // ---------------------------------------------------------------------

    function reviewReport(uint256 reportId, Status decision) external onlyReviewer {
        if (reportId >= _reports.length) revert UnknownReport();
        if (decision == Status.Pending) revert InvalidStatus();
        Report storage r = _reports[reportId];
        if (r.status != Status.Pending) revert AlreadyReviewed();

        Risk before = batchRisk(r.batchKey);

        r.status = decision;
        BatchStats storage stats = _batchStats[r.batchKey];
        stats.pending -= 1;
        if (decision == Status.Confirmed) {
            stats.confirmed += 1;
            if (r.pharmacyId != bytes32(0)) _pharmacyStats[r.pharmacyId].confirmedFakes += 1;
        } else {
            stats.rejected += 1;
        }

        emit ReportReviewed(reportId, r.batchKey, msg.sender, decision);
        _emitRiskChange(r.batchKey, before);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function batchRisk(bytes32 batchKey) public view returns (Risk) {
        BatchStats memory s = _batchStats[batchKey];
        if (s.confirmed >= confirmThreshold) return Risk.ConfirmedFake;
        if (s.pending >= suspicionThreshold) return Risk.Suspected;
        return Risk.None;
    }

    function getBatch(bytes32 batchKey) external view returns (BatchStats memory stats, Risk risk, uint256[] memory reportIds) {
        return (_batchStats[batchKey], batchRisk(batchKey), _reportsByBatch[batchKey]);
    }

    function getPharmacy(bytes32 pharmacyId) external view returns (PharmacyStats memory) {
        return _pharmacyStats[pharmacyId];
    }

    function getReport(uint256 reportId) external view returns (Report memory) {
        if (reportId >= _reports.length) revert UnknownReport();
        return _reports[reportId];
    }

    function reportCount() external view returns (uint256) {
        return _reports.length;
    }

    /// @notice Newest-first page of reports, for feeds and the reviewer queue.
    function getRecentReports(uint256 offset, uint256 limit)
        external
        view
        returns (Report[] memory page, uint256[] memory ids)
    {
        uint256 total = _reports.length;
        if (offset >= total) return (new Report[](0), new uint256[](0));
        uint256 n = total - offset < limit ? total - offset : limit;
        page = new Report[](n);
        ids = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            uint256 id = total - 1 - offset - i;
            page[i] = _reports[id];
            ids[i] = id;
        }
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setReviewer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isReviewer[account] = allowed;
        emit ReviewerSet(account, allowed);
    }

    function setRelayer(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        isRelayer[account] = allowed;
        emit RelayerSet(account, allowed);
    }

    function setThresholds(uint32 confirmThreshold_, uint32 suspicionThreshold_, uint64 submitCooldown_)
        external
        onlyOwner
    {
        if (confirmThreshold_ == 0 || suspicionThreshold_ == 0) revert InvalidThreshold();
        confirmThreshold = confirmThreshold_;
        suspicionThreshold = suspicionThreshold_;
        submitCooldown = submitCooldown_;
        emit ThresholdsSet(confirmThreshold_, suspicionThreshold_, submitCooldown_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function _emitRiskChange(bytes32 batchKey, Risk before) private {
        Risk afterRisk = batchRisk(batchKey);
        if (afterRisk != before) emit BatchRiskChanged(batchKey, afterRisk);
    }
}
