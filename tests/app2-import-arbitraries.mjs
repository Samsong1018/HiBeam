// Shared fast-check arbitraries for the APP2 monthly import property tests.
import fc from 'fast-check';

const money = fc.oneof(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }).map((n) => `$${n.toLocaleString('en-US')}`), fc.constant(null));
const category = fc.oneof(fc.constantFrom('Rent', 'Groceries', 'Dining Out', 'Savings', 'Roth IRA', 'Clothing', 'Misc'), fc.string({ minLength: 1, maxLength: 30 }));
const month = fc.constantFrom('June', 'July', 'August', 'September', 'October', 'November', 'December', 'Q4', '');

export const workbookArb = fc.record({
  'Budget vs Actual': fc.array(fc.record({ Category: category, 'Budget ($)': money, 'Actual ($)': money }), { maxLength: 15 }),
  'Monthly Spending': fc.array(fc.record({ Month: month, 'Spending ($)': money }), { maxLength: 8 }),
  'Net Worth': fc.array(fc.record({ Month: month, 'Net Worth ($)': fc.oneof(money, fc.integer({ min: -50000, max: 0 })) }), { maxLength: 8 }),
  Accounts: fc.array(fc.record({ Account: fc.string({ maxLength: 20 }), 'Balance ($)': money }), { maxLength: 5 }),
  Debts: fc.array(fc.record({ Debt: fc.string({ maxLength: 20 }), 'Balance ($)': money, 'APR (%)': fc.oneof(fc.double({ min: 0, max: 40, noNaN: true }), fc.constant(null)) }), { maxLength: 5 }),
});
