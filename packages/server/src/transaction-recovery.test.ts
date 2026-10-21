import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTypeDescriptor } from "@bdp/protocol";
import { afterEach, expect, it } from "vitest";
import { openTransactionStore } from "./transaction-store.js";

const scope = "https://example.test/recovery/",
  type = "https://example.test/bead";
const types = [parseTypeDescriptor({ id: type, name: "Bead", describes: "bead", conformsTo: [] })];
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function isDeleteJournalSetup(sql: string): boolean {
  return sql
    .split(";")
    .some((statement) => /^\s*PRAGMA\s+journal_mode\s*=\s*DELETE\s*$/i.test(statement));
}
it("recognizes rollback journal setup after secure-delete without matching unrelated pragmas", () => {
  for (const sql of [
    "PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL",
    "PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL",
    " PRAGMA secure_delete=ON ; pragma JOURNAL_MODE = delete ; ",
  ])
    expect(isDeleteJournalSetup(sql)).toBe(true);
  for (const sql of [
    "PRAGMA secure_delete=ON",
    "PRAGMA journal_mode=WAL",
    "SELECT 'PRAGMA journal_mode=DELETE'",
    "PRAGMA cache_size=8",
  ])
    expect(isDeleteJournalSetup(sql)).toBe(false);
});

it.each(["before-maintenance-commit", "after-terminal"] as const)(
  "recovers a hot journal after process death inside %s without losing committed pages",
  (stage) => {
    const directory = mkdtempSync(path.join(tmpdir(), "bdp-hot-journal-"));
    directories.push(directory);
    const file = path.join(directory, "owner.sqlite");
    const options = { file, scope, types, create: true, receiptMaximumItems: 2 };
    const store = new URL("../dist/transaction-store.js", import.meta.url).href;
    const batch = new URL("../dist/transaction-batch.js", import.meta.url).href;
    const script = `
      import { writeSync } from 'node:fs';
      import { DatabaseSync } from 'node:sqlite';
      import { openTransactionStore } from ${JSON.stringify(store)};
      import { prepareTransaction } from ${JSON.stringify(batch)};
      const isDeleteJournalSetup = ${isDeleteJournalSetup.toString()};
      let cacheSetup = null;
      // A small real SQLite cache forces dirty-page spill in the terminal case;
      // maintenance uses the ordinary owner cache and over 3 MiB of receipts.
      if (${JSON.stringify(stage)} === 'after-terminal') {
        const exec = DatabaseSync.prototype.exec;
        DatabaseSync.prototype.exec = function(sql) {
          const result = exec.call(this, sql);
          if (isDeleteJournalSetup(sql)) {
            exec.call(this, 'PRAGMA cache_size=8');
            cacheSetup = { matchedSql: sql, requestedPages: 8, actualPages: this.prepare('PRAGMA cache_size').get().cache_size };
            if (cacheSetup.actualPages !== 8) throw new Error('hot-journal cache setup did not take effect');
          }
          return result;
        };
      }
      let armed=false, now=1000;
      const owner=openTransactionStore({...${JSON.stringify(options)},clock:()=>now,fault(at){
        if(armed && at===${JSON.stringify(stage)}) process.kill(process.pid,'SIGKILL');
      }});
      function submit(n) {
        const operations=Array.from({length:3},(_,i)=>({operation:'createBead',id:'beads/b'+n+'_'+i,type:${JSON.stringify(type)},properties:{n,i,pad:'x'.repeat(18000)}}));
        const claim=owner.admit('p','key'+n,prepareTransaction(${JSON.stringify(scope)},JSON.stringify({operations})));
        return owner.executeObserved(claim.claim).receipt;
      }
      const receipts=Array.from({length:60},(_,n)=>{const r=submit(n);return {id:r.id,next:r.next};});
      if (${JSON.stringify(stage)} === 'after-terminal' && !cacheSetup) throw new Error('hot-journal cache setup not reached');
      writeSync(1,JSON.stringify({receipts, cacheSetup})); armed=true;
      if(${JSON.stringify(stage)}==='before-maintenance-commit'){now=86401001;owner.maintain();}else submit(60);
      throw new Error('fault did not terminate process');
    `;
    const child = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 20000,
    });
    const journal = existsSync(`${file}-journal`) ? readFileSync(`${file}-journal`) : undefined;
    if (process.env.BDP_HOT_JOURNAL_EVIDENCE)
      writeFileSync(
        `${process.env.BDP_HOT_JOURNAL_EVIDENCE}-${stage}.json`,
        JSON.stringify(
          {
            stage,
            script,
            child: {
              status: child.status,
              signal: child.signal,
              error: child.error?.message ?? null,
              stdout: child.stdout,
              stderr: child.stderr,
            },
            journalBytes: journal?.length ?? null,
            journalHeaderHex: journal?.subarray(0, 8).toString("hex") ?? null,
          },
          null,
          2,
        ) + "\n",
      );
    expect(child.error).toBeUndefined();
    expect(child.signal, child.stderr).toBe("SIGKILL");
    const { receipts, cacheSetup } = JSON.parse(child.stdout) as {
      receipts: { id: string; next: string }[];
      cacheSetup: { matchedSql: string; requestedPages: number; actualPages: number } | null;
    };
    expect(receipts).toHaveLength(60);
    if (stage === "after-terminal") {
      expect(cacheSetup).toMatchObject({ requestedPages: 8, actualPages: 8 });
      expect(isDeleteJournalSetup(cacheSetup?.matchedSql ?? "")).toBe(true);
    } else expect(cacheSetup).toBeNull();
    // A nonzero rollback-journal header distinguishes an actual recovery case
    // from the harmless postcommit exit covered by the paging smoke.
    expect(readFileSync(`${file}-journal`).subarray(0, 8)).toEqual(
      Buffer.from("d9d505f920a163d7", "hex"),
    );
    const reopenFiles = [file];
    if (stage === "after-terminal") {
      const refusedFile = path.join(directory, "refused.sqlite");
      cpSync(file, refusedFile);
      cpSync(`${file}-journal`, `${refusedFile}-journal`);
      reopenFiles.push(refusedFile);
      // SQLite must recover the copied hot journal before configuration can be read;
      // incompatible installation refusal must still precede BDP cleanup.
      expect(() =>
        openTransactionStore({
          ...options,
          file: refusedFile,
          create: false,
          receiptMaximumItems: 3,
          clock: () => 86401001,
        }),
      ).toThrow("installation mismatch");
      expect(existsSync(`${refusedFile}-journal`)).toBe(false);
    }
    // The successful opener must independently encounter the original hot image.
    expect(readFileSync(`${file}-journal`).subarray(0, 8)).toEqual(
      Buffer.from("d9d505f920a163d7", "hex"),
    );
    // Check both branches: the untouched crash image and the recovered copy
    // whose refused open must not retract pending work or sweep receipt detail.
    for (const reopenFile of reopenFiles) {
      const owner = openTransactionStore({
        ...options,
        file: reopenFile,
        create: false,
        clock: () => 1000,
      });
      try {
        expect(owner.recoveredPending).toBe(stage === "after-terminal" ? 1 : 0);
        expect(owner.inspect().groups).toHaveLength(60);
        expect(owner.inspect().resources).toHaveLength(180);
        for (const [n, receipt] of receipts.entries()) {
          expect(owner.readReceipt("p", receipt.id).receipt).toMatchObject({
            detail: "available",
            next: receipt.next,
          });
          expect(owner.readReceiptPage("p", receipt.next)).toMatchObject({
            kind: "page",
            page: {
              receipt: receipt.id,
              next: null,
              results: [{ resource: { properties: { n, i: 2, pad: "x".repeat(18000) } } }],
            },
          });
        }
      } finally {
        owner.close();
      }
    }
  },
  25000,
);
