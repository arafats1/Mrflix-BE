'use strict';

const SAVINGS_GOAL_ID_PATTERN = /^[a-zA-Z0-9_-]{6,64}$/;
const SAVINGS_TRANSACTION_PREFIX = 'SAV_';

function clampMoney(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.max(0, Math.round(amount));
}

function createGoalId() {
  return `goal_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeSavingsGoals(input) {
  if (!Array.isArray(input)) return [];

  const goals = input
    .map((goal, index) => {
      const name = String(goal?.name || '').trim();
      const targetAmountUGX = clampMoney(goal?.targetAmountUGX);
      const savedAmountUGX = clampMoney(goal?.savedAmountUGX);
      const allocationPercent = Math.max(0, Math.min(100, Math.round(Number(goal?.allocationPercent || 0))));
      const rawId = String(goal?.id || '').trim();
      
      // In Strapi 5, we might receive the database ID or documentId.
      // We want to preserve IDs that look like our generated goal IDs or database IDs.
      const id = (SAVINGS_GOAL_ID_PATTERN.test(rawId) || /^\d+$/.test(rawId) || rawId.length > 5) ? rawId : createGoalId();
      
      if (!name || targetAmountUGX <= 0) return null;
      const cappedSaved = Math.min(savedAmountUGX, targetAmountUGX);
      const progressPercent = targetAmountUGX > 0 ? Math.min(100, Math.round((cappedSaved / targetAmountUGX) * 100)) : 0;
      return {
        id,
        name,
        targetAmountUGX,
        savedAmountUGX: cappedSaved,
        allocationPercent,
        progressPercent,
        isCompleted: cappedSaved >= targetAmountUGX,
        updatedAt: goal?.updatedAt || new Date().toISOString(),
        order: Number.isFinite(Number(goal?.order)) ? Number(goal.order) : index,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.order - right.order);

  // Note: we deliberately do NOT reject when total > 100%. The frontend shows
  // the running total and warns the user, but the backend should always
  // persist whatever the user sends so a stray test goal can't permanently
  // block them from saving.

  return goals.map((goal, index) => ({ ...goal, order: index }));
}

function buildSavingsSnapshot(profile) {
  const goals = normalizeSavingsGoals(Array.isArray(profile?.savingsGoals) ? profile.savingsGoals : []);
  return {
    goals,
    totalSavingsUGX: clampMoney(profile?.totalSavingsUGX),
    unallocatedSavingsUGX: clampMoney(profile?.unallocatedSavingsUGX),
    savingsLifetimeDepositedUGX: clampMoney(profile?.savingsLifetimeDepositedUGX),
  };
}

function applyDepositToSavings(profile, amountUGX) {
  const amount = clampMoney(amountUGX);
  if (amount <= 0) {
    const err = new Error('Deposit amount must be greater than zero');
    err.status = 400;
    throw err;
  }

  const snapshot = buildSavingsSnapshot(profile);
  const totalSavingsUGX = snapshot.totalSavingsUGX + amount;
  let unallocatedSavingsUGX = snapshot.unallocatedSavingsUGX + amount;
  const goals = snapshot.goals.map((goal) => ({ ...goal }));

  for (const goal of goals) {
    if (goal.isCompleted || goal.allocationPercent <= 0) continue;
    const intendedAllocation = Math.floor((amount * goal.allocationPercent) / 100);
    if (intendedAllocation <= 0) continue;
    const remaining = Math.max(0, goal.targetAmountUGX - goal.savedAmountUGX);
    const applied = Math.min(remaining, intendedAllocation, unallocatedSavingsUGX);
    if (applied <= 0) continue;
    goal.savedAmountUGX += applied;
    goal.progressPercent = Math.min(100, Math.round((goal.savedAmountUGX / goal.targetAmountUGX) * 100));
    goal.isCompleted = goal.savedAmountUGX >= goal.targetAmountUGX;
    goal.updatedAt = new Date().toISOString();
    unallocatedSavingsUGX = Math.max(0, unallocatedSavingsUGX - applied);
  }

  return {
    totalSavingsUGX,
    unallocatedSavingsUGX,
    savingsLifetimeDepositedUGX: snapshot.savingsLifetimeDepositedUGX + amount,
    savingsGoals: goals,
  };
}

function allocateUnallocatedSavings(profile, goalsInput) {
  // If goalsInput is the list of goals from the request, we should use that
  // as the base, but we must ensure we don't accidentally wipe out 
  // savedAmountUGX if it wasn't provided in the input (it should be, but let's be safe).
  
  // Normalize the input goals first
  const normalizedInput = normalizeSavingsGoals(goalsInput);

  // Calculate how much was already allocated in the EXISTING profile
  const existingGoals = Array.isArray(profile?.savingsGoals) ? profile.savingsGoals : [];
  
  // The client-provided goals might missing savedAmountUGX for existing goals, or have old values.
  // We MUST map the existing saved amounts back to the goals matched by ID.
  const syncedGoalsInput = normalizedInput.map(goal => {
    const existing = existingGoals.find(eg => eg.id === goal.id);
    return {
      ...goal,
      savedAmountUGX: existing ? clampMoney(existing.savedAmountUGX) : clampMoney(goal.savedAmountUGX)
    };
  });

  const snapshot = buildSavingsSnapshot({
    ...profile,
    savingsGoals: syncedGoalsInput,
  });

  // Recalculate unallocated balance based on the NEW goal set.
  // totalSavingsUGX = unallocated + sum(savedAmountUGX)
  // So, new unallocated = totalSavingsUGX - sum(synced savedAmountUGX)
  const newAllocatedTotal = snapshot.goals.reduce((sum, g) => sum + g.savedAmountUGX, 0);
  let unallocatedSavingsUGX = Math.max(0, snapshot.totalSavingsUGX - newAllocatedTotal);

  const baseUnallocatedSavingsUGX = unallocatedSavingsUGX;
  const goals = snapshot.goals.map((goal) => ({
    ...goal,
    updatedAt: new Date().toISOString(),
    // Ensure we re-calculate progress percent because savedAmountUGX might have changed
    progressPercent: goal.targetAmountUGX > 0 ? Math.min(100, Math.round((goal.savedAmountUGX / goal.targetAmountUGX) * 100)) : 0,
    isCompleted: goal.savedAmountUGX >= goal.targetAmountUGX
  }));

  if (unallocatedSavingsUGX <= 0) {
    return {
      totalSavingsUGX: snapshot.totalSavingsUGX,
      unallocatedSavingsUGX: 0,
      savingsLifetimeDepositedUGX: snapshot.savingsLifetimeDepositedUGX,
      savingsGoals: goals,
    };
  }

  // First pass: try to apply full allocation percentages regardless of existing amounts
  // This handles the "added a goal after depositing" scenario
  for (const goal of goals) {
    if (goal.isCompleted || goal.allocationPercent <= 0 || unallocatedSavingsUGX <= 0) continue;
    
    // Calculate how much THIS goal SHOULD HAVE from the CURRENT unallocated pool
    // based on its allocation percentage.
    const remaining = Math.max(0, goal.targetAmountUGX - goal.savedAmountUGX);
    if (remaining <= 0) continue;

    const intendedAllocation = Math.floor((baseUnallocatedSavingsUGX * goal.allocationPercent) / 100);
    if (intendedAllocation <= 0) continue;

    const applied = Math.min(remaining, intendedAllocation, unallocatedSavingsUGX);
    if (applied <= 0) continue;

    goal.savedAmountUGX += applied;
    goal.progressPercent = Math.min(100, Math.round((goal.savedAmountUGX / goal.targetAmountUGX) * 100));
    goal.isCompleted = goal.savedAmountUGX >= goal.targetAmountUGX;
    goal.updatedAt = new Date().toISOString();
    unallocatedSavingsUGX = Math.max(0, unallocatedSavingsUGX - applied);
  }

  return {
    totalSavingsUGX: snapshot.totalSavingsUGX,
    unallocatedSavingsUGX,
    savingsLifetimeDepositedUGX: snapshot.savingsLifetimeDepositedUGX,
    savingsGoals: goals,
  };
}

/**
 * Apply a completed savings deposit purchase to its child profile.
 * Idempotent: sets `savingsDepositApplied=true` after applying so it
 * won't double-credit even if invoked multiple times.
 *
 * @param {object} strapi
 * @param {object} purchase  Purchase row with at least { id, amount, status, transactionId, savingsDepositApplied, childProfile }
 * @returns {Promise<boolean>} true if applied, false if skipped
 */
async function applySavingsDepositPurchase(strapi, purchase) {
  if (!purchase || purchase.status !== 'completed') return false;
  const txn = String(purchase.transactionId || '');
  if (!txn.startsWith(SAVINGS_TRANSACTION_PREFIX)) return false;
  if (purchase.savingsDepositApplied) return false;

  const childProfileId = purchase.childProfile?.id || purchase.childProfile;
  if (!childProfileId) return false;

  const profile = await strapi.db.query('api::child-profile.child-profile').findOne({
    where: { id: childProfileId },
  });
  if (!profile) return false;

  const next = applyDepositToSavings(profile, purchase.amount);
  await strapi.entityService.update('api::child-profile.child-profile', profile.id, {
    data: next,
  });
  await strapi.db.query('api::purchase.purchase').update({
    where: { id: purchase.id },
    data: { savingsDepositApplied: true },
  });
  strapi.log.info(`[savings] Applied deposit purchase ${purchase.id} (UGX ${purchase.amount}) to child ${profile.id}`);
  return true;
}

module.exports = {
  SAVINGS_GOAL_ID_PATTERN,
  SAVINGS_TRANSACTION_PREFIX,
  clampMoney,
  createGoalId,
  normalizeSavingsGoals,
  buildSavingsSnapshot,
  applyDepositToSavings,
  allocateUnallocatedSavings,
  applySavingsDepositPurchase,
};
