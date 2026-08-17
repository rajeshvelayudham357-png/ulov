/**
 * Growth BI metric definitions — apply ONLY to /admin/analytics/growth/* endpoints.
 * Existing analytics pages use their own definitions and are unchanged.
 */

export const GROWTH_METRIC_DEFINITIONS = {
  TOTAL_CALLS: {
    key: "TOTAL_CALLS",
    label: "Total Calls",
    definition:
      "Count of all call_histories rows whose createdAt falls within the selected IST period.",
  },
  CONNECTED_CALLS: {
    key: "CONNECTED_CALLS",
    label: "Connected Calls",
    definition:
      "Calls where duration > 0 OR status IN ('accepted','completed','ended','ongoing','in_progress').",
  },
  CALLS_GT_5_SEC: {
    key: "CALLS_GT_5_SEC",
    label: "Calls > 5 Seconds",
    definition: "Connected calls with duration >= 5 seconds.",
  },
  CALLS_GT_30_SEC: {
    key: "CALLS_GT_30_SEC",
    label: "Calls > 30 Seconds",
    definition: "Connected calls with duration >= 30 seconds (healthy engagement).",
  },
  CALLS_GT_60_SEC: {
    key: "CALLS_GT_60_SEC",
    label: "Calls > 60 Seconds",
    definition: "Connected calls with duration >= 60 seconds.",
  },
  CALLS_GT_5_MIN: {
    key: "CALLS_GT_5_MIN",
    label: "Calls > 5 Minutes",
    definition: "Connected calls with duration >= 300 seconds.",
  },
  CALL_SUCCESS_RATE: {
    key: "CALL_SUCCESS_RATE",
    label: "Call Success Rate",
    definition:
      "Calls with duration >= 30 seconds / connected calls × 100. Does NOT use completed/total.",
  },
  CREATOR_ANSWER_RATE: {
    key: "CREATOR_ANSWER_RATE",
    label: "Creator Answer Rate",
    definition:
      "Incoming calls to creators that were answered (not missed/rejected/cancelled and duration > 0 or accepted status) / total incoming calls × 100.",
  },
  REGISTERED_USERS: {
    key: "REGISTERED_USERS",
    label: "Registered Users",
    definition: "Users whose createdAt falls within the selected IST period.",
  },
  ACTIVE_USERS: {
    key: "ACTIVE_USERS",
    label: "Active Users",
    definition:
      "Users whose lastSeen falls within the selected IST period (activityDefinition: lastSeen).",
  },
  PAYING_USERS: {
    key: "PAYING_USERS",
    label: "Paying Users",
    definition:
      "Distinct users with at least one successful payment (updatedAt) in the selected IST period.",
  },
  FIRST_TIME_PAYERS: {
    key: "FIRST_TIME_PAYERS",
    label: "First-Time Payers",
    definition:
      "Users whose first successful payment updatedAt falls within the selected IST period.",
  },
  REPEAT_PAYERS: {
    key: "REPEAT_PAYERS",
    label: "Repeat Payers",
    definition:
      "Users with 2+ successful payments where at least one payment updatedAt falls in the period.",
  },
  PAYER_CONVERSION: {
    key: "PAYER_CONVERSION",
    label: "Payer Conversion Rate",
    definition:
      "Paying users in period / registered users in period × 100.",
  },
  REPEAT_PAYER_RATE: {
    key: "REPEAT_PAYER_RATE",
    label: "Repeat Payer Rate",
    definition: "Repeat payers in period / paying users in period × 100.",
  },
  ARPU: {
    key: "ARPU",
    label: "Average Revenue Per User",
    definition: "Gross recharge revenue in period / active users in period.",
  },
  ARPPU: {
    key: "ARPPU",
    label: "Average Revenue Per Paying User",
    definition: "Gross recharge revenue in period / paying users in period.",
  },
  GROSS_REVENUE: {
    key: "GROSS_REVENUE",
    label: "Gross Recharge Revenue",
    definition:
      "Sum of payment_orders.amount for successful payments (updatedAt in IST period). Inclusive of GST.",
  },
  GST: {
    key: "GST",
    label: "GST",
    definition:
      "GST portion extracted from gross revenue using splitInclusiveGst() and admin_gst_settings.",
  },
  NET_REVENUE: {
    key: "NET_REVENUE",
    label: "Net Revenue",
    definition: "Gross recharge revenue minus GST (baseRevenue from splitInclusiveGst).",
  },
  CREATOR_PAYOUT: {
    key: "CREATOR_PAYOUT",
    label: "Creator Payout",
    definition:
      "Sum of withdraws.amount with status IN ('approved','completed','success') where createdAt is in period.",
  },
  CONTRIBUTION: {
    key: "CONTRIBUTION",
    label: "Estimated Contribution",
    definition:
      "Net revenue minus configured costs (gateway fees, creator payouts, refunds, marketing, other). Unconfigured costs are excluded, not assumed zero.",
  },
  D1_RETENTION: {
    key: "D1_RETENTION",
    label: "D1 Retention",
    definition:
      "Cohort users active (lastSeen) on IST day +1 after registration / cohort size × 100.",
  },
  D3_RETENTION: {
    key: "D3_RETENTION",
    label: "D3 Retention",
    definition:
      "Cohort users active (lastSeen) on IST day +3 after registration / cohort size × 100.",
  },
  D7_RETENTION: {
    key: "D7_RETENTION",
    label: "D7 Retention",
    definition:
      "Cohort users active (lastSeen) on IST day +7 after registration / cohort size × 100.",
  },
  D14_RETENTION: {
    key: "D14_RETENTION",
    label: "D14 Retention",
    definition:
      "Cohort users active (lastSeen) on IST day +14 after registration / cohort size × 100.",
  },
  D30_RETENTION: {
    key: "D30_RETENTION",
    label: "D30 Retention",
    definition:
      "Cohort users active (lastSeen) on IST day +30 after registration / cohort size × 100.",
  },
};

/**
 * Sequential funnel comparability for Growth user / revenue funnels.
 * Counts are unchanged — this only governs whether conversion percentages are shown.
 */
export const GROWTH_FUNNEL_STAGE_SEMANTICS = {
  ad_impression: {
    populationDefinition:
      "Ad impression events recorded in growth_events for the selected IST period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  store_visit: {
    populationDefinition:
      "Store / landing page visit events recorded in growth_events for the selected IST period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  install: {
    populationDefinition:
      "Distinct anonymous install identifiers with APP_INSTALL events in the selected IST period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  creator_viewed: {
    populationDefinition:
      "Distinct users with CREATOR_PROFILE_VIEWED events in the selected IST period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  registration: {
    populationDefinition:
      "Users whose createdAt falls within the selected IST period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  profile_completed: {
    populationDefinition:
      "Users registered in the selected IST period with profileCompleted = 1.",
    subsetOfPrevious: true,
    subsetOfRegistration: true,
  },
  chat_started: {
    populationDefinition:
      "Distinct users who sent at least one chat message in the period (any user, not limited to the registration cohort).",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  first_recharge: {
    populationDefinition:
      "Users whose first-ever successful payment updatedAt falls within the selected IST period (any user, not limited to chat starters).",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  repeat_recharge: {
    populationDefinition:
      "Users with 2+ lifetime successful payments who also made at least one payment in the selected period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  paying_users: {
    populationDefinition:
      "Distinct users with at least one successful payment updatedAt in the selected period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  first_time_payers: {
    populationDefinition:
      "Users whose first-ever successful payment updatedAt falls within the selected period.",
    subsetOfPrevious: true,
    subsetOfRegistration: false,
  },
  repeat_payers: {
    populationDefinition:
      "Users with 2+ lifetime successful payments who also paid in the selected period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
  recharge_transactions: {
    populationDefinition:
      "Count of successful payment_orders rows in the selected period.",
    subsetOfPrevious: false,
    subsetOfRegistration: false,
  },
};

/** Call-event funnel stages are progressive filters on the same call population. */
export const GROWTH_CALL_FUNNEL_SEMANTICS = {
  subsetOfPrevious: true,
  subsetOfRegistration: false,
  populationDefinition:
    "All call_histories rows in the selected IST period, progressively filtered by call outcome/duration.",
};

export const GROWTH_ACTIVITY_DEFINITION = {
  dau: "Users whose lastSeen falls within the IST calendar day.",
  wau: "Users whose lastSeen falls within the last 7 IST days ending on the period end date.",
  mau: "Users whose lastSeen falls within the last 30 IST days ending on the period end date.",
  returningUsers:
    "Users registered before the period who had lastSeen activity within the period.",
  reactivatedUsers:
    "Users whose lastSeen is in the period but lastSeen before period start was more than 14 IST days ago.",
};
