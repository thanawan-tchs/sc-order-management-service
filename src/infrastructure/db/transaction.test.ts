import { expect } from "chai";
import sinon from "sinon";
import * as prismaClientModule from "./prismaClient";
import { withTransaction } from "./transaction";

describe("withTransaction", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("runs the callback against prisma.$transaction and returns its resolved value", async () => {
    const fakeTx = { marker: "tx" };
    const $transaction = sinon.stub().callsFake((fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx));
    sinon.stub(prismaClientModule, "getPrismaClient").returns({ $transaction } as never);

    const result = await withTransaction(async (tx) => {
      expect(tx).to.equal(fakeTx);
      return "ok";
    });

    expect(result).to.equal("ok");
    expect($transaction.calledOnce).to.equal(true);
  });

  it("propagates an error thrown inside the callback", async () => {
    const simulatedFailure = new Error("simulated failure inside the transaction");
    const $transaction = sinon.stub().callsFake((fn: (tx: unknown) => Promise<unknown>) => fn({}));
    sinon.stub(prismaClientModule, "getPrismaClient").returns({ $transaction } as never);

    await expect(
      withTransaction(async () => {
        throw simulatedFailure;
      })
    ).to.be.rejectedWith(simulatedFailure);
  });
});
