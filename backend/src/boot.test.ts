import { describe, expect, it } from "vitest";
import { brokerCredentialsProvider, type BackendBootstrap } from "./boot";

const boot: BackendBootstrap = {
  connectionId: "c1",
  credentialsUrl: "http://127.0.0.1:1/credentials",
  credentialsToken: "tok",
  account: { accountId: "123456789012", region: "eu-west-1" },
};

const CREDS = {
  accessKeyId: "AKIA",
  secretAccessKey: "s",
  sessionToken: "t",
  expiration: new Date(Date.now() + 3_600_000).toISOString(),
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("brokerCredentialsProvider", () => {
  it("re-requests (without the stale id) when a polled approval is not found", async () => {
    // The broker race / restart case: the approval we were polling vanished. The provider
    // must start a FRESH request — not surface "approval not found" to the user.
    const bodies: unknown[] = [];
    const responses = [
      json(200, { approvalRequired: true, approval: { id: "A" } }), // initial → park approval A
      json(500, { message: "approval not found" }), // poll A → the broker lost it
      json(200, { approvalRequired: true, approval: { id: "B" } }), // fresh request → approval B
      json(200, CREDS), // poll B → approved + vended
    ];
    const provider = brokerCredentialsProvider(boot, {
      fetchImpl: async (_url, init) => {
        bodies.push(init?.body ? JSON.parse(init.body as string) : undefined);
        return responses.shift()!;
      },
      sleep: async () => {},
    });

    const creds = await provider();
    expect(creds.accessKeyId).toBe("AKIA");
    // The decisive assertion: after "not found", the re-request carried NO approvalId.
    expect(bodies).toEqual([undefined, { approvalId: "A" }, undefined, { approvalId: "B" }]);
  });

  it("single-flights concurrent callers into one mint", async () => {
    // Two AWS calls at poppy-open must share ONE credential request — two parallel
    // mints on a supervised connection parked two approvals (two authorization
    // prompts for a single open).
    let posts = 0;
    const provider = brokerCredentialsProvider(boot, {
      fetchImpl: async () => {
        posts++;
        await new Promise((r) => setTimeout(r, 10)); // let the second caller pile in
        return json(200, CREDS);
      },
      sleep: async () => {},
    });

    const [a, b] = await Promise.all([provider(), provider()]);
    expect(a.accessKeyId).toBe("AKIA");
    expect(b.accessKeyId).toBe("AKIA");
    expect(posts).toBe(1);
  });

  it("still fails fast on a non-retryable refusal", async () => {
    const provider = brokerCredentialsProvider(boot, {
      fetchImpl: async () => json(500, { message: "this operation was denied by the user" }),
      sleep: async () => {},
    });
    await expect(provider()).rejects.toThrow(/denied/);
  });
});
