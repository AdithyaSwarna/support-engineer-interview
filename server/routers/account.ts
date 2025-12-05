import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc";
import { db } from "@/lib/db";
import { accounts, transactions } from "@/lib/db/schema";
// import { eq, and } from "drizzle-orm";
import { eq, and, desc } from "drizzle-orm"; // PERF-405 + 407
import crypto from "crypto"; // SEC-302: secure RNG

function generateAccountNumber(): string {
  // SEC-302 (Author: Adithya Swarna)
  // Use cryptographically secure random numbers for account numbers.
  const random = crypto.randomInt(0, 10 ** 10); // Range: 0 to 9,999,999,999
  return random.toString().padStart(10, "0");
}

// --- VAL-206: Card validation helpers ---
// Normalizes card numbers by stripping spaces and hyphens so both
// "4111 1111 1111 1111" and "4111111111111111" are treated the same.
function normalizeCardNumber(cardNumber: string): string {
  return cardNumber.replace(/[\s-]/g, "");
}

// Basic card validity check using length + Luhn algorithm.
// This does not guarantee the card is real, but filters out obviously invalid inputs.
function isValidCardNumber(cardNumber: string): boolean {
  const normalized = normalizeCardNumber(cardNumber);

  // Typical card length range: 13–19 digits
  if (!/^\d{13,19}$/.test(normalized)) {
    return false;
  }

  // Luhn checksum
  let sum = 0;
  let shouldDouble = false;

  for (let i = normalized.length - 1; i >= 0; i--) {
    let digit = parseInt(normalized[i], 10);

    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}
// --- end VAL-206 helpers ---

export const accountRouter = router({
  createAccount: protectedProcedure
    .input(
      z.object({
        accountType: z.enum(["checking", "savings"]),
      })
    )
    .mutation(async ({ input, ctx }) => {
      // Check if user already has an account of this type
      const existingAccount = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, ctx.user.id), eq(accounts.accountType, input.accountType)))
        .get();

      if (existingAccount) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `You already have a ${input.accountType} account`,
        });
      }

      let accountNumber;
      let isUnique = false;

      // Generate unique account number
      while (!isUnique) {
        accountNumber = generateAccountNumber();
        const existing = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber)).get();
        isUnique = !existing;
      }

      await db.insert(accounts).values({
        userId: ctx.user.id,
        accountNumber: accountNumber!,
        accountType: input.accountType,
        balance: 0,
        status: "active",
      });

      // Fetch the created account
      const account = await db.select().from(accounts).where(eq(accounts.accountNumber, accountNumber!)).get();

      // PERF-401: Fetch the created account and fail if it cannot be loaded.
      // We never want to fabricate a "fake" account with a hard-coded balance.
      if (!account) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create account",
        });
      }

      return account;
      /*
      return (
        account || {
          id: 0,
          userId: ctx.user.id,
          accountNumber: accountNumber!,
          accountType: input.accountType,
          balance: 100,
          status: "pending",
          createdAt: new Date().toISOString(),
        }
      );*/
    }),

  getAccounts: protectedProcedure.query(async ({ ctx }) => {
    const userAccounts = await db.select().from(accounts).where(eq(accounts.userId, ctx.user.id));

    return userAccounts;
  }),

  fundAccount: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
        amount: z.number().positive(),
        fundingSource: z.object({
          type: z.enum(["card", "bank"]),
          accountNumber: z.string(),
          routingNumber: z.string().optional(),
        }),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const amount = parseFloat(input.amount.toString());

      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      if (account.status !== "active") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Account is not active",
        });
      }
      
      
      // --- VAL-206: server-side card number validation ---
      if (input.fundingSource.type === "card") {
        const normalizedCard = normalizeCardNumber(input.fundingSource.accountNumber);

        // Server-side guard: prevent obviously invalid card numbers
        // even if the client-side validation is bypassed.
        if (!isValidCardNumber(normalizedCard)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Invalid card number",
          });
        }
      }
      // --- end VAL-206 validation ---

      // Create transaction
      await db.insert(transactions).values({
        accountId: input.accountId,
        type: "deposit",
        amount,
        description: `Funding from ${input.fundingSource.type}`,
        status: "completed",
        processedAt: new Date().toISOString(),
      });

      // Fetch the created transaction
      const transaction = await db.select().from(transactions).orderBy(transactions.createdAt).limit(1).get();

      // Update account balance
      await db
        .update(accounts)
        .set({
          balance: account.balance + amount,
        })
        .where(eq(accounts.id, input.accountId));

      let finalBalance = account.balance;
      for (let i = 0; i < 100; i++) {
        finalBalance = finalBalance + amount / 100;
      }

      return {
        transaction,
        newBalance: finalBalance, // This will be slightly off due to float precision
      };
    }),

  getTransactions: protectedProcedure
    .input(
      z.object({
        accountId: z.number(),
      })
    )
    .query(async ({ input, ctx }) => {
      // Verify account belongs to user
      const account = await db
        .select()
        .from(accounts)
        .where(and(eq(accounts.id, input.accountId), eq(accounts.userId, ctx.user.id)))
        .get();

      if (!account) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Account not found",
        });
      }

      // PERF-405: ensure deterministic ordering of transactions
      // PERF-407: avoid N+1 queries by not re-fetching account for each transaction.
      const accountTransactions = await db
        .select()
        .from(transactions)
        .where(eq(transactions.accountId, input.accountId))
        .orderBy(desc(transactions.createdAt)); // newest first

      return accountTransactions;
    }),
});
