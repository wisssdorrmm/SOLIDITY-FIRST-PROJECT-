import { NAFDAC_GREENBOOK_URL } from "@/lib/references.ts";

export default function About() {
  return (
    <>
      <h1>How CheckAm works</h1>
      <div className="card">
        <h2>1. Read the pack</h2>
        <p>
          Your phone reads the NAFDAC number, batch number and dates straight from the camera. The text reading happens
          on your phone, so it works even on a slow connection.
        </p>
        <h2>2. Check it</h2>
        <p>
          We check the NAFDAC number format and whether it belongs to this product, and look for expired, impossible or
          tampered dates. When it&apos;s switched on, an AI compares the packaging with what the genuine pack should look like.
        </p>
        <h2>3. Warn everyone</h2>
        <p>
          If a pack is fake, report it. Reports are stored on a public blockchain, so sellers of fakes can&apos;t delete or
          bribe them away. Trusted reviewers confirm reports, and once a batch is confirmed fake, everyone who scans it
          sees the warning.
        </p>
      </div>
      <div className="card">
        <h2>What CheckAm can&apos;t do</h2>
        <p>
          A camera can&apos;t see what&apos;s inside a tablet. Good fakes can look exactly like the real thing. CheckAm
          can only flag warning signs; it can never prove a drug is genuine. Buy from licensed pharmacies, check numbers
          on the{" "}
          <a href={NAFDAC_GREENBOOK_URL} target="_blank" rel="noreferrer">
            NAFDAC Greenbook
          </a>
          , and report suspected fakes to NAFDAC too.
        </p>
      </div>
    </>
  );
}
