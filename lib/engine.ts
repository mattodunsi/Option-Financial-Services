// @ts-nocheck
/* Ported unchanged from the tested browser engine (loan-assessment-cam.html). */

const Engine = (function () {
  'use strict';

  /* ---- Business rules (single source of truth) ---- */
  const DEFAULT_RULES = {
    institution: 'Option Financial Services',
    processingFeePct: 2,          // % of loan amount
    insurancePct: 0.85,           // % of loan amount
    minMonthlyRatePct: 4.2,       // interest must be at least this, per month
    defaultMonthlyRatePct: 4.2,   // pre-filled on a new assessment
    interestMethod: 'flat',       // 'flat' or 'reducing'
    feeTreatment: 'financed',     // 'financed' = fees added to repayment, 'upfront' = deducted from payout
    maxDtiPct: 40,                // maximum debt-to-income ratio
    includeExpensesInDti: false,  // count living expenses as obligations in DTI
    incomeBasis: 'declared',      // 'declared' or 'lower' (lower of declared and bank credits)
    minTenor: 1,
    maxTenor: 12,
    minLoanAmount: 10000,
    roundDownTo: 1000,            // recommended amounts are rounded down to this step
    bankMinMonths: 3,
    bankIncomeTolerancePct: 20,   // bank credits may be this % below declared income
    bankMaxDebitToCreditPct: 95,
    bankMinBalanceMultiple: 1,    // average balance should cover this many monthly repayments
    bankMaxReturnedItems: 0,

    // Product classification (loan amount picks the product automatically)
    dlsMaxAmount: 200000,         // Daily (DLS): minLoanAmount .. this
    dlsInterestPct: 10,           // flat, for the whole DLS facility (not per day)
    dlsMaxDays: 20,
    wlsMaxAmount: 500000,         // Weekly (WLS): dlsMaxAmount+1 .. this
    wlsInterestPer4WeeksPct: 5,   // charged per 4-week block of the tenor
    wlsMaxWeeks: 12,
    // amounts above wlsMaxAmount are Monthly (MLS), priced by the existing monthly rules above
    daysPerMonth: 30,             // assumption used to convert DLS tenor to an equivalent month, for DTI
    weeksPerMonth: 4.33,          // assumption used to convert WLS tenor to an equivalent month, for DTI

    // Eligibility
    maxCustomerAge: 60,

    // Collateral / guarantor tiers, by loan amount
    collTier1Max: 700000,         // Tier 1: minLoanAmount .. this
    collTier2Max: 3000000,        // Tier 2: tier1Max+1 .. this
    collTier3Max: 5000000,        // Tier 3: tier2Max+1 .. this
    collTier4Max: 10000000,       // Tier 4: tier3Max+1 .. this (nothing configured above this)
    stockHypothecationPctLow: 200,  // tiers 1-2
    stockHypothecationPctHigh: 300, // tiers 3-4
    tangibleCollateralPctTier4: 110
  };

  /* ---- Helpers ---- */
  const round2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
  const group = s => s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  function money(n) {
    if (!isFinite(n)) return '\u2014';
    const s = Math.abs(n).toFixed(2).split('.');
    return (n < -0.004 ? '\u2212' : '') + '\u20A6' + group(s[0]) + '.' + s[1];
  }
  function money0(n) {
    if (!isFinite(n)) return '\u2014';
    return (n < 0 ? '\u2212' : '') + '\u20A6' + group(String(Math.round(Math.abs(n))));
  }
  const pct = (n, d) => isFinite(n) ? n.toFixed(d === undefined ? 2 : d) + '%' : '\u2014';
  const num = (n, dp) => String(parseFloat(Number(n).toFixed(dp === undefined ? 2 : dp)));
  function toNum(s) {
    if (s === '' || s === null || s === undefined) return NaN;
    const n = parseFloat(String(s).replace(/,/g, ''));
    return isFinite(n) ? n : NaN;
  }
  const isValidNgPhone = s => /^(?:0|\+?234)[789][01]\d{8}$/.test(String(s || '').replace(/[\s-]/g, ''));

  /* ---- Pricing maths ---- */
  // Per-naira factors so the same maths gives both the loan cost and the maximum affordable amount.
  function factors(R, ratePct, n) {
    const r = ratePct / 100;
    const feeRate = (R.processingFeePct + R.insurancePct) / 100;
    let pi, interestPerNaira;
    if (R.interestMethod === 'reducing') {
      pi = r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));   // annuity instalment
      interestPerNaira = pi * n - 1;
    } else {
      interestPerNaira = r * n;                               // flat: amount x rate x months
      pi = (1 + interestPerNaira) / n;
    }
    const feeMonthly = R.feeTreatment === 'financed' ? feeRate / n : 0;
    return { r, feeRate, pi, interestPerNaira, monthlyPerNaira: pi + feeMonthly };
  }

  function computeLoan(R, principal, ratePct, n) {
    const f = factors(R, ratePct, n);
    const financed = R.feeTreatment === 'financed';
    const processingFee = round2(principal * R.processingFeePct / 100);
    const insurance = round2(principal * R.insurancePct / 100);
    const interest = round2(principal * f.interestPerNaira);
    const totalRepayment = round2(principal + interest + (financed ? processingFee + insurance : 0));
    return {
      principal, tenor: n, ratePct, processingFee, insurance, interest, totalRepayment,
      monthlyRepayment: round2(totalRepayment / n),
      netDisbursement: financed ? principal : round2(principal - processingFee - insurance),
      totalCost: round2(interest + processingFee + insurance),
      financed
    };
  }

  function schedule(R, loan) {
    const n = loan.tenor, P = loan.principal, r = loan.ratePct / 100;
    const f = factors(R, loan.ratePct, n);
    const feeTotal = loan.financed ? round2(loan.processingFee + loan.insurance) : 0;
    const rows = [];
    let balU = P, sumP = 0, sumI = 0, sumF = 0;
    for (let i = 1; i <= n; i++) {
      let interest, principalPart;
      if (R.interestMethod === 'reducing') { interest = balU * r; principalPart = P * f.pi - interest; balU -= principalPart; }
      else { interest = P * r; principalPart = P / n; }
      let p = round2(principalPart), it = round2(interest), fe = round2(feeTotal / n);
      if (i === n) { p = round2(P - sumP); it = round2(loan.interest - sumI); fe = round2(feeTotal - sumF); }
      sumP = round2(sumP + p); sumI = round2(sumI + it); sumF = round2(sumF + fe);
      rows.push({ no: i, principal: p, interest: it, fees: fe, instalment: round2(p + it + fe), balance: Math.max(0, round2(P - sumP)) });
    }
    return rows;
  }

  /* ---- Product classification (DLS / WLS / MLS) ---- */
  function classifyProduct(amount, R) {
    if (!(amount > 0)) return null;
    if (amount <= R.dlsMaxAmount) return 'DLS';
    if (amount <= R.wlsMaxAmount) return 'WLS';
    return 'MLS';
  }
  const PRODUCT_NAMES = { DLS: 'Daily Loan (DLS)', WLS: 'Weekly Loan (WLS)', MLS: 'Monthly Loan (MLS)' };
  function productTenorLimits(product, R) {
    if (product === 'DLS') return { min: 1, max: R.dlsMaxDays, unit: 'day' };
    if (product === 'WLS') return { min: 1, max: R.wlsMaxWeeks, unit: 'week' };
    return { min: R.minTenor, max: R.maxTenor, unit: 'month' };
  }

  /* ---- Age ---- */
  function computeAge(dobStr, asOf) {
    if (!dobStr) return NaN;
    const dob = new Date(dobStr + 'T00:00:00');
    if (isNaN(dob.getTime())) return NaN;
    const now = asOf || new Date();
    let age = now.getFullYear() - dob.getFullYear();
    const m = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age;
  }

  /* ---- Per-product pricing ----
     Returns a shape compatible with computeLoan()'s output (same field names), plus
     product-specific extras (periods/periodLabel/periodicRepayment). monthlyRepayment
     is always the DTI-equivalent monthly figure, so existing DTI/affordability code
     that reads loan.monthlyRepayment works unchanged for every product. */
  function productMonthlyPerNaira(R, product, tenorValue, ratePct) {
    if (product === 'MLS') return factors(R, ratePct, tenorValue).monthlyPerNaira;
    const feeRate = (R.processingFeePct + R.insurancePct) / 100;
    const feeOnce = R.feeTreatment === 'financed' ? feeRate : 0;
    if (product === 'DLS') {
      const interestPerNaira = R.dlsInterestPct / 100;
      const monthsEquivalent = tenorValue / R.daysPerMonth;
      return (1 + interestPerNaira + feeOnce) / monthsEquivalent;
    }
    // WLS
    const interestPerNaira = (R.wlsInterestPer4WeeksPct / 100) * (tenorValue / 4);
    const monthsEquivalent = tenorValue / R.weeksPerMonth;
    return (1 + interestPerNaira + feeOnce) / monthsEquivalent;
  }

  function computeProductLoan(R, product, principal, tenorValue, ratePct) {
    if (product === 'MLS') {
      const loan = computeLoan(R, principal, ratePct, tenorValue);
      return Object.assign({}, loan, {
        product, periods: tenorValue, periodLabel: 'month',
        periodicRepayment: loan.monthlyRepayment, equivalentMonthlyRepayment: loan.monthlyRepayment
      });
    }
    const processingFee = round2(principal * R.processingFeePct / 100);
    const insurance = round2(principal * R.insurancePct / 100);
    const financed = R.feeTreatment === 'financed';
    let interest, periodLabel, monthsEquivalent, effRatePct;
    if (product === 'DLS') {
      interest = round2(principal * R.dlsInterestPct / 100);
      periodLabel = 'day'; monthsEquivalent = tenorValue / R.daysPerMonth; effRatePct = R.dlsInterestPct;
    } else { // WLS
      interest = round2(principal * R.wlsInterestPer4WeeksPct / 100 * (tenorValue / 4));
      periodLabel = 'week'; monthsEquivalent = tenorValue / R.weeksPerMonth; effRatePct = R.wlsInterestPer4WeeksPct;
    }
    const totalRepayment = round2(principal + interest + (financed ? processingFee + insurance : 0));
    const periodicRepayment = round2(totalRepayment / tenorValue);
    const equivalentMonthlyRepayment = round2(totalRepayment / monthsEquivalent);
    return {
      product, principal, tenor: tenorValue, periods: tenorValue, periodLabel, ratePct: effRatePct,
      processingFee, insurance, interest, totalRepayment,
      monthlyRepayment: equivalentMonthlyRepayment, periodicRepayment, equivalentMonthlyRepayment,
      netDisbursement: financed ? principal : round2(principal - processingFee - insurance),
      totalCost: round2(interest + processingFee + insurance), financed
    };
  }

  // Highest loan (rounded down) whose equivalent-monthly repayment keeps total obligations within the DTI ceiling.
  function maxAffordable(R, incomeUsed, fixed, ratePct, n, product) {
    product = product || 'MLS';
    const ceiling = R.maxDtiPct / 100 * incomeUsed;
    const room = ceiling - fixed;
    if (!(room > 0)) return { room: Math.max(0, room), raw: 0, max: 0 };
    const raw = room / productMonthlyPerNaira(R, product, n, ratePct);
    const step = Math.max(1, Math.round(R.roundDownTo) || 1);
    let max = Math.floor(raw / step + 1e-9) * step;
    const fits = P => fixed + computeProductLoan(R, product, P, n, ratePct).monthlyRepayment <= ceiling + 0.01;
    while (max > 0 && !fits(max)) max -= step;
    return { room, raw, max: Math.max(0, max) };
  }

  /* ---- Collateral / guarantor requirements ---- */
  function collateralRequirements(amount, R) {
    if (!(amount > 0)) return null;
    let tier, guarantors, guarantorCheques, clientChequesRequired, stockPct, tangiblePct, notes;
    if (amount <= R.collTier1Max) {
      tier = 1; guarantors = 1; guarantorCheques = 0; clientChequesRequired = 0;
      stockPct = R.stockHypothecationPctLow; tangiblePct = 0;
      notes = ['1 guarantor', num(stockPct, 0) + '% stock hypothecation', 'Household asset pledge'];
    } else if (amount <= R.collTier2Max) {
      tier = 2; guarantors = 1; guarantorCheques = 0; clientChequesRequired = 6;
      stockPct = R.stockHypothecationPctLow; tangiblePct = 0;
      notes = ['1 guarantor', '6 client cheques', num(stockPct, 0) + '% stock hypothecation', 'Household asset pledge'];
    } else if (amount <= R.collTier3Max) {
      tier = 3; guarantors = 2; guarantorCheques = 3; clientChequesRequired = 6;
      stockPct = R.stockHypothecationPctHigh; tangiblePct = 0;
      notes = ['2 guarantors (3 cheques each)', '6 client cheques, commensurate with tenor', num(stockPct, 0) + '% stock hypothecation', 'Acceptable collateral (e.g. vehicle)'];
    } else {
      tier = 4; guarantors = 2; guarantorCheques = null; clientChequesRequired = 6;
      stockPct = R.stockHypothecationPctHigh; tangiblePct = R.tangibleCollateralPctTier4;
      notes = ['2 guarantors (cheques covering half the tenor each)', '6 client cheques, commensurate with tenor', num(stockPct, 0) + '% stock hypothecation', 'Minimum ' + num(tangiblePct, 0) + '% tangible collateral'];
    }
    const stockRequired = round2(amount * stockPct / 100);
    const tangibleRequired = tangiblePct > 0 ? round2(amount * tangiblePct / 100) : 0;
    return { tier, guarantors, guarantorCheques, clientChequesRequired, stockPct, stockRequired, tangiblePct, tangibleRequired, notes };
  }

  function collateralCoverage(req, provided) {
    if (!req) return null;
    const guarantorsProvided = isNaN(provided.guarantors) ? 0 : provided.guarantors;
    const chequesProvided = isNaN(provided.cheques) ? 0 : provided.cheques;
    const stockValue = isNaN(provided.stockValue) ? NaN : provided.stockValue;
    const tangibleValue = isNaN(provided.tangibleValue) ? NaN : provided.tangibleValue;
    const stockCoveragePct = !isNaN(stockValue) && req.stockRequired > 0 ? stockValue / req.stockRequired * 100 : NaN;
    const tangibleCoveragePct = !isNaN(tangibleValue) && req.tangibleRequired > 0 ? tangibleValue / req.tangibleRequired * 100 : NaN;
    return {
      guarantorsProvided, guarantorsOk: guarantorsProvided >= req.guarantors,
      chequesProvided, chequesOk: chequesProvided >= req.clientChequesRequired,
      stockValue, stockCoveragePct, stockOk: !isNaN(stockCoveragePct) ? stockCoveragePct >= 100 : null,
      tangibleValue, tangibleCoveragePct,
      tangibleOk: req.tangibleRequired > 0 ? (!isNaN(tangibleCoveragePct) ? tangibleCoveragePct >= 100 : null) : true
    };
  }

  /* ---- Decision engine: APPROVE / REFER FOR REVIEW / DECLINE, with explicit reasons ---- */
  function decisionEngine(ctx) {
    const declineReasons = [], referReasons = [];
    if (ctx.age !== null && !isNaN(ctx.age) && ctx.age > ctx.maxAge) {
      declineReasons.push('Customer age (' + ctx.age + ') is above the maximum permitted age of ' + ctx.maxAge + '.');
    }
    if (ctx.verdict === 'none') {
      declineReasons.push('No loan amount at or above the minimum (' + money0(ctx.minLoanAmount) + ') keeps DTI within ' + num(ctx.maxDtiPct) + '%.');
    } else if (ctx.verdict === 'exceeds') {
      referReasons.push('Requested amount exceeds the ' + num(ctx.maxDtiPct) + '% DTI limit; a reduced amount is affordable.');
    }
    if (ctx.amount < ctx.minLoanAmount) {
      declineReasons.push('Requested amount is below the minimum loan of ' + money0(ctx.minLoanAmount) + '.');
    }
    if (ctx.coverage) {
      if (ctx.coverage.guarantorsOk === false) referReasons.push('Only ' + ctx.coverage.guarantorsProvided + ' of ' + ctx.collateral.guarantors + ' required guarantor(s) provided.');
      if (ctx.coverage.chequesOk === false && ctx.collateral.clientChequesRequired > 0) referReasons.push('Only ' + ctx.coverage.chequesProvided + ' of ' + ctx.collateral.clientChequesRequired + ' required client cheques provided.');
      if (ctx.coverage.stockOk === false) referReasons.push('Stock hypothecation coverage is ' + pct(ctx.coverage.stockCoveragePct, 0) + ', below the required 100%.');
      if (ctx.coverage.stockOk === null) referReasons.push('Stock/collateral value has not been entered, so coverage cannot be confirmed.');
      if (ctx.coverage.tangibleOk === false) referReasons.push('Tangible collateral coverage is ' + pct(ctx.coverage.tangibleCoveragePct, 0) + ', below the required 100%.');
      if (ctx.coverage.tangibleOk === null) referReasons.push('Tangible collateral value has not been entered, so coverage cannot be confirmed.');
    }
    if (ctx.warnCount > 0) referReasons.push(ctx.warnCount + ' bank-statement or affordability item(s) flagged for review.');

    let status;
    if (declineReasons.length) status = 'decline';
    else if (referReasons.length) status = 'refer';
    else status = 'approve';
    return { status, declineReasons, referReasons };
  }

  /* ---- Input parsing and validation ---- */
  function parseForm(f) {
    return {
      name: (f.name || '').trim(), dob: (f.dob || '').trim(), phone: (f.phone || '').trim(), purpose: (f.purpose || '').trim(),
      businessName: (f.businessName || '').trim(), occupation: (f.occupation || '').trim(),
      income: toNum(f.income), expenses: toNum(f.expenses), existing: toNum(f.existing),
      amount: toNum(f.amount), tenor: toNum(f.tenor), rate: toNum(f.rate),
      bank: {
        name: (f.bankName || '').trim(), months: toNum(f.bankMonths), credits: toNum(f.bankCredits),
        debits: toNum(f.bankDebits), avgBalance: toNum(f.bankAvgBal), returned: toNum(f.bankReturned),
        verified: !!f.bankVerified
      },
      security: {
        guarantors: toNum(f.secGuarantors), cheques: toNum(f.secCheques),
        stockValue: toNum(f.secStockValue), tangibleValue: toNum(f.secTangibleValue)
      },
      officer: (f.officer || '').trim(), comments: (f.comments || '').trim()
    };
  }

  function validateForm(f, R) {
    const P = parseForm(f), errors = {};
    const hard = (k, msg) => { errors[k] = { msg, soft: false }; };
    const soft = (k, msg) => { errors[k] = { msg, soft: true }; };
    if (P.name.length < 2) hard('name', "Enter the customer's full name.");
    if (!P.phone) hard('phone', 'Enter a phone number.');
    else if (!isValidNgPhone(P.phone)) hard('phone', 'Enter a valid Nigerian number, such as 08012345678 or +2348012345678.');
    if (P.dob) {
      const age = computeAge(P.dob);
      if (isNaN(age)) hard('dob', 'Enter a valid date of birth.');
      else if (age < 0 || age > 110) hard('dob', 'Enter a realistic date of birth.');
    }
    if (!(P.income > 0)) hard('income', "Enter the customer's monthly income.");
    if (!(P.amount > 0)) hard('amount', 'Enter the loan amount requested.');
    else if (P.amount < R.minLoanAmount) soft('amount', 'The minimum loan is ' + money0(R.minLoanAmount) + '.');
    const product = classifyProduct(P.amount, R);
    const tl = productTenorLimits(product || 'MLS', R);
    if (isNaN(P.tenor)) hard('tenor', 'Choose or enter the tenor in ' + tl.unit + 's.');
    else if (P.tenor < tl.min || P.tenor > tl.max) hard('tenor', 'Tenor must be between ' + tl.min + ' and ' + tl.max + ' ' + tl.unit + 's for ' + (PRODUCT_NAMES[product] || 'this product') + '.');
    if (product === 'MLS') {
      if (isNaN(P.rate)) hard('rate', 'Enter the monthly interest rate.');
      else if (P.rate < R.minMonthlyRatePct) hard('rate', 'Interest cannot be below ' + num(R.minMonthlyRatePct) + '% per month.');
      else if (P.rate > 100) hard('rate', 'Enter a monthly rate of 100% or less.');
    }
    const b = P.bank;
    const anyBank = [b.months, b.credits, b.debits, b.avgBalance, b.returned].some(v => !isNaN(v));
    if (anyBank) {
      if (!(b.months > 0)) hard('bankMonths', 'Enter how many months the statement covers.');
      else if (b.months > 60) hard('bankMonths', 'Enter 60 months or fewer.');
      if (!(b.credits > 0)) hard('bankCredits', 'Enter the total credits for the period.');
    }
    const blocking = ['income', 'amount', 'tenor', 'rate', 'dob'].some(k => errors[k] && !errors[k].soft);
    return { errors, blocking, product };
  }

  function validateRules(c) {
    const e = {};
    const chk = (k, min, max, int) => {
      const v = c[k];
      if (!(typeof v === 'number' && isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v)))) {
        e[k] = 'Enter ' + (int ? 'a whole number' : 'a number') + ' from ' + min + ' to ' + group(String(max)) + '.';
      }
    };
    chk('processingFeePct', 0, 25); chk('insurancePct', 0, 25);
    chk('minMonthlyRatePct', 0, 50); chk('defaultMonthlyRatePct', 0, 50);
    chk('maxDtiPct', 1, 100);
    chk('minTenor', 1, 120, true); chk('maxTenor', 1, 120, true);
    chk('minLoanAmount', 0, 1e9); chk('roundDownTo', 1, 1e7);
    chk('bankMinMonths', 0, 60, true); chk('bankIncomeTolerancePct', 0, 100);
    chk('bankMaxDebitToCreditPct', 1, 200); chk('bankMinBalanceMultiple', 0, 20);
    chk('bankMaxReturnedItems', 0, 100, true);
    chk('dlsMaxAmount', 1, 1e9); chk('dlsInterestPct', 0, 100); chk('dlsMaxDays', 1, 365, true);
    chk('wlsMaxAmount', 1, 1e9); chk('wlsInterestPer4WeeksPct', 0, 100); chk('wlsMaxWeeks', 1, 104, true);
    chk('maxCustomerAge', 18, 120, true);
    chk('collTier1Max', 1, 1e9); chk('collTier2Max', 1, 1e9); chk('collTier3Max', 1, 1e9); chk('collTier4Max', 1, 1e9);
    chk('stockHypothecationPctLow', 0, 1000); chk('stockHypothecationPctHigh', 0, 1000); chk('tangibleCollateralPctTier4', 0, 1000);
    if (!e.defaultMonthlyRatePct && !e.minMonthlyRatePct && c.defaultMonthlyRatePct < c.minMonthlyRatePct) e.defaultMonthlyRatePct = 'The default rate cannot be below the minimum rate.';
    if (!e.minTenor && !e.maxTenor && c.minTenor > c.maxTenor) e.maxTenor = 'The maximum tenor cannot be below the minimum tenor.';
    if (!e.dlsMaxAmount && !e.minLoanAmount && c.dlsMaxAmount < c.minLoanAmount) e.dlsMaxAmount = 'The DLS maximum cannot be below the minimum loan amount.';
    if (!e.wlsMaxAmount && !e.dlsMaxAmount && c.wlsMaxAmount <= c.dlsMaxAmount) e.wlsMaxAmount = 'The WLS maximum must be above the DLS maximum.';
    if (!e.collTier2Max && !e.collTier1Max && c.collTier2Max <= c.collTier1Max) e.collTier2Max = 'Tier 2 must be above tier 1.';
    if (!e.collTier3Max && !e.collTier2Max && c.collTier3Max <= c.collTier2Max) e.collTier3Max = 'Tier 3 must be above tier 2.';
    if (!e.collTier4Max && !e.collTier3Max && c.collTier4Max <= c.collTier3Max) e.collTier4Max = 'Tier 4 must be above tier 3.';
    if (!['flat', 'reducing'].includes(c.interestMethod)) e.interestMethod = 'Choose an interest method.';
    if (!['financed', 'upfront'].includes(c.feeTreatment)) e.feeTreatment = 'Choose how fees are collected.';
    if (!['declared', 'lower'].includes(c.incomeBasis)) e.incomeBasis = 'Choose an income basis.';
    if (typeof c.includeExpensesInDti !== 'boolean') e.includeExpensesInDti = 'Choose yes or no.';
    if (typeof c.institution !== 'string' || !c.institution.trim()) e.institution = 'Enter the institution name.';
    return e;
  }

  function mergeRules(saved) {
    const out = Object.assign({}, DEFAULT_RULES);
    if (saved && typeof saved === 'object') {
      Object.keys(DEFAULT_RULES).forEach(k => {
        if (k in saved && typeof saved[k] === typeof DEFAULT_RULES[k]) {
          const cand = Object.assign({}, out, { [k]: saved[k] });
          if (Object.keys(validateRules(cand)).length === 0) out[k] = saved[k];
        }
      });
    }
    return out;
  }

  /* ---- Bank statement analysis ---- */
  function analyseBank(b, declaredIncome) {
    if (!(b.months > 0 && b.credits > 0)) return null;
    const avgMonthlyCredits = round2(b.credits / b.months);
    return {
      months: b.months, name: b.name, credits: b.credits, debits: b.debits,
      avgBalance: b.avgBalance, returned: b.returned, verified: b.verified,
      avgMonthlyCredits,
      avgMonthlyDebits: isNaN(b.debits) ? NaN : round2(b.debits / b.months),
      coveragePct: avgMonthlyCredits / declaredIncome * 100,
      debitCreditPct: isNaN(b.debits) ? NaN : b.debits / b.credits * 100
    };
  }

  /* ---- The assessment ---- */
  function assess(p, R) {
    const existing = isNaN(p.existing) ? 0 : p.existing;
    const expenses = isNaN(p.expenses) ? 0 : p.expenses;
    const bank = analyseBank(p.bank, p.income);

    const product = classifyProduct(p.amount, R);
    const tl = productTenorLimits(product, R);
    const unit = tl.unit; // 'day' | 'week' | 'month'

    let incomeUsed = p.income, incomeNote = '';
    if (R.incomeBasis === 'lower' && bank && bank.avgMonthlyCredits < p.income) {
      incomeUsed = bank.avgMonthlyCredits;
      incomeNote = 'Income taken from average monthly bank credits, which are lower than the declared income.';
    }
    const expIncl = R.includeExpensesInDti ? expenses : 0;
    const fixed = existing + expIncl;                       // obligations before the new loan
    const ceiling = round2(R.maxDtiPct / 100 * incomeUsed); // most the customer may pay each month
    const room = round2(ceiling - fixed);

    const metricsFor = loan => {
      const totalObl = round2(fixed + loan.monthlyRepayment);
      return {
        loan, totalObl,
        dti: totalObl / incomeUsed * 100,
        within: totalObl <= ceiling + 0.01,
        surplus: round2(incomeUsed - expenses - existing - loan.monthlyRepayment)
      };
    };

    const req = metricsFor(computeProductLoan(R, product, p.amount, p.tenor, p.rate));
    const currentDti = fixed / incomeUsed * 100;
    const cap = maxAffordable(R, incomeUsed, fixed, p.rate, p.tenor, product);

    let verdict, recommended;
    if (req.within) { verdict = 'within'; recommended = p.amount; }
    else if (cap.max >= R.minLoanAmount) { verdict = 'exceeds'; recommended = cap.max; }
    else { verdict = 'none'; recommended = 0; }

    const rec = verdict === 'exceeds' ? metricsFor(computeProductLoan(R, product, recommended, p.tenor, p.rate)) : null;
    const offer = verdict === 'within' ? req : (rec || req);
    const offerIsRecommended = offer !== req;

    /* Alternatives by tenor (within this product's own tenor range) */
    const tenorRows = [];
    for (let t = tl.min; t <= tl.max; t++) {
      const c = maxAffordable(R, incomeUsed, fixed, p.rate, t, product);
      const m = metricsFor(computeProductLoan(R, product, p.amount, t, p.rate));
      tenorRows.push({
        tenor: t, max: c.max,
        monthlyAtMax: c.max > 0 ? computeProductLoan(R, product, c.max, t, p.rate).monthlyRepayment : 0,
        requestedFits: m.within, requestedMonthly: m.loan.monthlyRepayment, requestedDti: m.dti
      });
    }
    let extend = null, bestAlt = null;
    if (verdict !== 'within') {
      extend = tenorRows.find(r => r.tenor > p.tenor && r.requestedFits) || null;
      bestAlt = tenorRows
        .filter(r => r.tenor > p.tenor && r.max > recommended && r.max >= R.minLoanAmount)
        .sort((a, b) => b.max - a.max || a.tenor - b.tenor)[0] || null;
    }

    /* Age eligibility */
    const age = p.dob ? computeAge(p.dob) : NaN;
    const ageEligible = isNaN(age) ? null : age <= R.maxCustomerAge;

    /* Collateral / guarantor requirement and coverage */
    const collateral = collateralRequirements(p.amount, R);
    const coverage = collateralCoverage(collateral, p.security);

    /* Reasoning text */
    const fixedLabel = R.includeExpensesInDti ? 'existing obligations and living expenses' : 'existing obligations';
    let title, reason;
    if (verdict === 'within') {
      title = 'Within affordability criteria';
      reason = 'DTI is ' + pct(req.dti) + ', inside the ' + num(R.maxDtiPct) + '% limit. Total monthly-equivalent obligations are ' +
        money(req.totalObl) + ' against a ceiling of ' + money(ceiling) + '.';
    } else if (verdict === 'exceeds') {
      title = 'Exceeds the ' + num(R.maxDtiPct) + '% DTI limit';
      reason = 'The customer\u2019s ' + fixedLabel + ' of ' + money0(fixed) + ' plus the new repayment of ' + money(req.loan.monthlyRepayment) +
        ' a month (equivalent) come to ' + money(req.totalObl) + ', or ' + pct(req.dti) + ' of income. The ceiling is ' + money(ceiling) +
        ', so the request is ' + money(round2(req.totalObl - ceiling)) + ' a month too high.';
    } else {
      title = 'No affordable loan at this income';
      reason = room <= 0
        ? 'Existing ' + fixedLabel.replace('existing ', '') + ' already take ' + pct(currentDti) + ' of income, which leaves no room under the ' + num(R.maxDtiPct) + '% limit.'
        : 'The room under the DTI limit (' + money(room) + ' a month) supports a loan of only ' + money0(cap.max) +
          ' over ' + p.tenor + ' ' + unit + (p.tenor > 1 ? 's' : '') + ', which is below the minimum loan of ' + money0(R.minLoanAmount) + '.';
    }

    /* Findings */
    const checks = [];
    const add = (level, text) => checks.push({ level, text });
    if (req.within) add('ok', 'DTI of ' + pct(req.dti) + ' is within the ' + num(R.maxDtiPct) + '% limit.');
    else add('fail', 'DTI of ' + pct(req.dti) + ' is above the ' + num(R.maxDtiPct) + '% limit.');
    if (p.amount < R.minLoanAmount) add('fail', 'The requested amount is below the minimum loan of ' + money0(R.minLoanAmount) + '.');
    if (ageEligible === false) add('fail', 'Customer age (' + age + ') is above the maximum permitted age of ' + R.maxCustomerAge + '.');
    else if (ageEligible === null) add('warn', 'Date of birth was not entered, so age eligibility has not been confirmed.');
    else add('ok', 'Customer age (' + age + ') is within the permitted maximum of ' + R.maxCustomerAge + '.');
    const basis = offerIsRecommended ? 'recommended' : 'requested';
    if (isNaN(p.expenses)) add('warn', 'Monthly expenses were not entered, so the cash cushion could not be checked.');
    else if (offer.surplus < 0) add('warn', 'After living expenses and all repayments the customer is short by ' + money(-offer.surplus) + ' a month (' + basis + ' loan).');
    else add('ok', money(offer.surplus) + ' is left each month after living expenses and all repayments (' + basis + ' loan).');

    if (coverage) {
      if (coverage.guarantorsOk) add('ok', coverage.guarantorsProvided + ' of ' + collateral.guarantors + ' required guarantor(s) provided.');
      else add('warn', 'Only ' + coverage.guarantorsProvided + ' of ' + collateral.guarantors + ' required guarantor(s) provided.');
      if (collateral.clientChequesRequired > 0) {
        if (coverage.chequesOk) add('ok', coverage.chequesProvided + ' of ' + collateral.clientChequesRequired + ' required client cheques provided.');
        else add('warn', 'Only ' + coverage.chequesProvided + ' of ' + collateral.clientChequesRequired + ' required client cheques provided.');
      }
      if (coverage.stockOk === true) add('ok', 'Stock hypothecation coverage is ' + pct(coverage.stockCoveragePct, 0) + '.');
      else if (coverage.stockOk === false) add('warn', 'Stock hypothecation coverage is only ' + pct(coverage.stockCoveragePct, 0) + '; ' + money0(collateral.stockRequired) + ' required.');
      else add('warn', 'Stock/collateral value not entered (' + money0(collateral.stockRequired) + ' required).');
      if (collateral.tangibleRequired > 0) {
        if (coverage.tangibleOk === true) add('ok', 'Tangible collateral coverage is ' + pct(coverage.tangibleCoveragePct, 0) + '.');
        else if (coverage.tangibleOk === false) add('warn', 'Tangible collateral coverage is only ' + pct(coverage.tangibleCoveragePct, 0) + '; ' + money0(collateral.tangibleRequired) + ' required.');
        else add('warn', 'Tangible collateral value not entered (' + money0(collateral.tangibleRequired) + ' required).');
      }
    }

    if (!bank) {
      add('warn', 'No bank statement figures were entered, so income has not been verified.');
    } else {
      if (bank.months < R.bankMinMonths) add('warn', 'The statement covers ' + bank.months + ' month(s); at least ' + R.bankMinMonths + ' are expected.');
      else add('ok', 'The statement covers ' + bank.months + ' months.');
      if (bank.coveragePct >= 100 - R.bankIncomeTolerancePct) add('ok', 'Average monthly credits of ' + money0(bank.avgMonthlyCredits) + ' support the declared income of ' + money0(p.income) + '.');
      else add('warn', 'Average monthly credits of ' + money0(bank.avgMonthlyCredits) + ' are only ' + pct(bank.coveragePct, 0) + ' of the declared income of ' + money0(p.income) + '.');
      if (!isNaN(bank.debitCreditPct)) {
        if (bank.debitCreditPct > R.bankMaxDebitToCreditPct) add('warn', 'Debits are ' + pct(bank.debitCreditPct, 0) + ' of credits, so the account retains very little money.');
        else add('ok', 'Debits are ' + pct(bank.debitCreditPct, 0) + ' of credits.');
      }
      if (!isNaN(bank.avgBalance)) {
        const need = offer.loan.monthlyRepayment * R.bankMinBalanceMultiple;
        if (bank.avgBalance < need) add('warn', 'Average balance of ' + money0(bank.avgBalance) + ' is below ' + num(R.bankMinBalanceMultiple) + 'x the monthly repayment (' + money(need) + ').');
        else add('ok', 'Average balance of ' + money0(bank.avgBalance) + ' covers the monthly repayment.');
      }
      if (!isNaN(bank.returned)) {
        if (bank.returned > R.bankMaxReturnedItems) add('warn', bank.returned + ' returned or failed transaction(s) on the statement.');
        else add('ok', 'No returned or failed transactions above the allowed number.');
      }
      if (bank.verified) add('ok', 'Officer confirmed the statement is genuine.');
      else add('warn', 'The statement has not been confirmed as genuine.');
    }
    const warnCount = checks.filter(c => c.level === 'warn').length;
    const failCount = checks.filter(c => c.level === 'fail').length;

    /* Decision engine: APPROVE / REFER FOR REVIEW / DECLINE */
    const decision = decisionEngine({
      age: isNaN(age) ? null : age, maxAge: R.maxCustomerAge,
      verdict, amount: p.amount, minLoanAmount: R.minLoanAmount, maxDtiPct: R.maxDtiPct,
      collateral, coverage,
      warnCount: Math.max(0, warnCount - (coverage ? [coverage.guarantorsOk, (collateral.clientChequesRequired <= 0 || coverage.chequesOk), coverage.stockOk !== false, (collateral.tangibleRequired <= 0 || coverage.tangibleOk !== false)].filter(x => x === false).length : 0))
    });

    /* Officer recommendation */
    let recommendation;
    const review = warnCount ? ' Clear the ' + warnCount + ' flagged item' + (warnCount > 1 ? 's' : '') + ' before disbursement.' : '';
    if (verdict === 'within' && p.amount < R.minLoanAmount) {
      recommendation = 'The request is within the DTI limit but below the minimum loan of ' + money0(R.minLoanAmount) + '. Do not proceed unless the amount is raised.';
    } else if (verdict === 'within') {
      recommendation = 'Recommend approval of ' + money0(p.amount) + ' over ' + p.tenor + ' ' + unit + (p.tenor > 1 ? 's' : '') + ' (DTI ' + pct(req.dti) + ').' + review;
    } else if (verdict === 'exceeds') {
      recommendation = 'Do not approve ' + money0(p.amount) + ' as requested. Recommend ' + money0(recommended) + ' over ' + p.tenor + ' ' + unit + (p.tenor > 1 ? 's' : '') + ' (DTI ' + pct(rec.dti) + ').' + review;
    } else {
      recommendation = 'Recommend decline. No amount at or above the minimum loan of ' + money0(R.minLoanAmount) + ' fits within the DTI limit at this income and tenor.';
      if (bestAlt) recommendation += ' A tenor of ' + bestAlt.tenor + ' ' + unit + 's would support up to ' + money0(bestAlt.max) + '.';
    }

    return {
      product, productName: PRODUCT_NAMES[product], unit,
      age: isNaN(age) ? null : age, ageEligible, collateral, coverage, decision,
      inputs: { income: p.income, incomeUsed, incomeNote, expenses, expensesProvided: !isNaN(p.expenses), existing, amount: p.amount, tenor: p.tenor, rate: p.rate },
      fixed, ceiling, room, currentDti, cap,
      req, rec, offer, offerIsRecommended,
      dti: req.dti, within: req.within, verdict, recommended, title, reason,
      tenorRows, extend, bestAlt,
      bank, checks, warnCount, failCount, recommendation
    };
  }

  return {
    DEFAULT_RULES, round2, money, money0, pct, num, toNum, isValidNgPhone,
    factors, computeLoan, schedule, maxAffordable,
    classifyProduct, PRODUCT_NAMES, productTenorLimits, computeAge, computeProductLoan,
    collateralRequirements, collateralCoverage, decisionEngine,
    parseForm, validateForm, validateRules, mergeRules, analyseBank, assess
  };
})();

// Exported as `any`: this is tested, battle-proven JS logic (see the test suites in the
// original browser app) ported unchanged, not freshly-typed code — strict call-signature
// inference here would fight optional/default-style JS params for no real safety benefit.
export default Engine as any;
