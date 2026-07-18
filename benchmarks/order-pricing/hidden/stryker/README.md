# StrykerJS Mutation Testing — Order Pricing Benchmark

This directory contains the StrykerJS configuration for mutation testing the
order-pricing reference implementation. Mutation testing evaluates whether the
test suite can detect intentionally introduced defects (mutants). A mutant that
survives (passes all tests) indicates a gap in test coverage.

## How to Run Mutation Tests

### Prerequisites

Ensure the reference-impl package has the Stryker dependencies installed:

```bash
cd /home/rmax-10/src/regenerable-software-lab
pnpm install
```

### Run Full Mutation Test

From the reference-impl directory (recommended):

```bash
cd /home/rmax-10/src/regenerable-software-lab/benchmarks/order-pricing/reference-impl
npx stryker run ../hidden/stryker/stryker.config.mjs
```

Or via pnpm script:

```bash
cd /home/rmax-10/src/regenerable-software-lab/benchmarks/order-pricing/reference-impl
pnpm run test:mutation
```

### Dry Run (Quick Verification)

To verify the configuration without running the full mutation suite:

```bash
cd /home/rmax-10/src/regenerable-software-lab/benchmarks/order-pricing/reference-impl
npx stryker run ../hidden/stryker/stryker.config.mjs --dryRunOnly
```

Or via pnpm script:

```bash
cd /home/rmax-10/src/regenerable-software-lab/benchmarks/order-pricing/reference-impl
pnpm run test:mutation:dry
```

### Using the npm Script

If the `test:mutation` script is configured in `package.json`:

```bash
cd /home/rmax-10/src/regenerable-software-lab/benchmarks/order-pricing/reference-impl
pnpm run test:mutation
```

## How to Interpret the Score

### Mutation Score

The **mutation score** is the percentage of mutants that were killed (detected)
by the test suite:

```
mutation score = killed mutants / (killed mutants + survived mutants)
```

- **100%**: Every injected defect is caught by at least one test. Ideal.
- **80%+** (high threshold): Strong test coverage for the domain logic.
- **60–80%** (low-to-high): Moderate coverage. Some logic paths are untested.
- **Below 60%** (below low threshold): Significant gaps in the test suite.
- **Below 50%** (break threshold): The build will fail.

### Understanding Results

The HTML report provides a file-by-file breakdown showing:
- Which lines/methods had mutants generated
- Whether each mutant was killed or survived
- The test that killed the mutant (if applicable)

### Thresholds

| Threshold | Value | Meaning |
|-----------|-------|---------|
| High      | 80%   | Target score for acceptable coverage |
| Low       | 60%   | Warning threshold — scores below this are flagged |
| Break     | 50%   | Build fails if score drops below this |

## The 15 Mutation Operators

The following 15 mutation operators are defined in the canonical specification
(SPEC.md §11). Each targets specific files in the reference implementation.

| # | Operator | Description | Target Files |
|---|----------|-------------|--------------|
| 1 | Replace addition with subtraction | Change `+` to `-` in monetary calculations (e.g., `add()` → `sub()`) | `calculator.ts` |
| 2 | Remove tax application | Omit or skip tax calculation entirely | `calculator.ts` |
| 3 | Apply tax before discount | Calculate tax on gross subtotal instead of taxable amount | `calculator.ts` |
| 4 | Change greater-than to greater-than-or-equal | Change `>` to `>=` (e.g., discount floor check) | `calculator.ts` |
| 5 | Skip rounding | Omit `toFixed()` or use incorrect precision | `calculator.ts` |
| 6 | Use binary floating-point values | Replace `Decimal.js` with raw `Number` arithmetic | `calculator.ts` |
| 7 | Ignore duplicate request identifiers | Skip idempotency key checks | `routes/orders.ts`, `routes/items.ts`, `routes/discounts.ts`, `order-store.ts` |
| 8 | Permit zero quantity | Accept quantity 0 instead of rejecting it | `routes/items.ts` |
| 9 | Permit negative discount values | Accept negative discount values | `routes/discounts.ts` |
| 10 | Return HTTP 200 instead of validation errors | Return success status for invalid requests | `routes/orders.ts`, `routes/items.ts`, `routes/discounts.ts` |
| 11 | Remove order-state validation | Skip the `assertDraft` check | `order-store.ts` |
| 12 | Ignore one discount type | Only handle percentage or fixed discounts, not both | `calculator.ts`, `order-store.ts` |
| 13 | Round intermediate values incorrectly | Round at wrong steps or use truncation | `calculator.ts` |
| 14 | Remove an item without invalidating totals | Skip line total recalculation on item removal | `order-store.ts` |
| 15 | Return internal exception messages | Expose stack traces or internal error details in HTTP responses | `server.ts` (excluded from mutation — entry point wiring) |

### File Coverage Summary

| File | Mutation Operators | Notes |
|------|-------------------|-------|
| `calculator.ts` | 1, 2, 3, 4, 5, 6, 12, 13 | Core calculation logic — highest mutation density |
| `order-store.ts` | 7, 11, 12, 14 | Store operations and state validation |
| `routes/orders.ts` | 7, 10 | Order creation, retrieval, calculation endpoints |
| `routes/items.ts` | 7, 8, 10 | Item CRUD endpoints |
| `routes/discounts.ts` | 7, 9, 10 | Discount CRUD endpoints |
| `server.ts` | 15 | **Excluded** — entry point wiring, not domain logic |

## Classifying Equivalent Mutants

Equivalent mutants are mutants that produce semantically identical behavior to
the original program — they are syntactically different but functionally
equivalent. These must be identified and excluded from the score calculation.

### How to Classify

1. **Run the mutation test** and review the HTML report.
2. For each **survived mutant**, examine the mutated code and ask: *"Does this
   change the observable behavior of the service for any valid input?"*
3. If the answer is **no**, classify the mutant as **equivalent**.

### Common Equivalent Mutant Patterns in This Project

- **String formatting changes**: Mutations that change how monetary values are
  formatted but produce the same 2-decimal output (e.g., rounding from
  `ROUND_HALF_UP` to `ROUND_DOWN` when the test data produces the same string).
- **Redundant condition mutations**: Changing comparison operators in dead code
  paths or conditions that are always true/false due to prior validation.
- **Type narrowing mutations**: Mutations that change type guards in ways that
  don't affect runtime behavior because the input is already validated by Zod.

### How to Exclude Equivalent Mutants

StrykerJS supports excluding mutants via several mechanisms:

1. **Inline comments**: Add `// Stryker disable next-line <mutator-name>` in the
   source code above known safe expressions.
2. **Configuration exclusions**: In `stryker.config.mjs`, add an `excludeMutations`
   array to skip entire mutator classes.
3. **Manual classification**: Use the HTML report UI to mark individual mutants
   as equivalent during review.

### Reporting Requirements

When reporting mutation results, clearly distinguish:

```
Total mutants: 120
Killed: 95
Survived: 20
Equivalent (non-executable): 5
Mutation score (raw): 95/115 = 82.6%
Mutation score (adjusted for equivalents): 95/120 = 79.2%
```

Always report both the raw score (excluding equivalents) and the adjusted score
(including equivalents in the denominator) for transparency.
