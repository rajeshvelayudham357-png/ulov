import test from "node:test";
import assert from "node:assert/strict";

import {
  clampPercentage,
  computeCreatorEarnings,
  computeMaleCallCost,
  parseOptionalRate,
  resolveEffectiveRate,
} from "../../utils/callRate.util.js";

test("parseOptionalRate treats empty values as global fallback", () => {
  assert.equal(parseOptionalRate(null), null);
  assert.equal(parseOptionalRate(undefined), null);
  assert.equal(parseOptionalRate(""), null);
  assert.equal(parseOptionalRate(25), 25);
  assert.equal(parseOptionalRate("40"), 40);
  assert.equal(parseOptionalRate(-1), null);
});

test("resolveEffectiveRate uses custom rate when present", () => {
  assert.equal(resolveEffectiveRate(45, 10, 60), 45);
  assert.equal(resolveEffectiveRate(null, 10, 60), 10);
  assert.equal(resolveEffectiveRate(undefined, 10, 60), 10);
});

test("voice billing uses per-minute rate for full minutes", () => {
  const result = computeMaleCallCost({
    durationSeconds: 120,
    type: "voice",
    ratePerMinute: 45,
  });

  assert.equal(result.type, "voice");
  assert.equal(result.minutes, 2);
  assert.equal(result.maleCost, 90);
});

test("video billing charges half-minute minimum in first 30 seconds", () => {
  const result = computeMaleCallCost({
    durationSeconds: 20,
    type: "video",
    ratePerMinute: 60,
  });

  assert.equal(result.type, "video");
  assert.equal(result.minutes, 0.5);
  assert.equal(result.maleCost, 30);
});

test("creator earnings respect custom percentage", () => {
  const earnings = computeCreatorEarnings({
    maleCost: 90,
    coinValue: 69 / 160,
    creatorPercentage: 80,
  });

  assert.equal(earnings.femaleEarn, 72);
  assert.equal(earnings.femaleEarningPercentage, 80);
  assert.ok(earnings.femaleAmount > 0);
  assert.ok(earnings.platformAmount >= 0);
});

test("clampPercentage stays within 0 and 100", () => {
  assert.equal(clampPercentage(-5, 50), 0);
  assert.equal(clampPercentage(150, 50), 100);
  assert.equal(clampPercentage(30, 50), 30);
});

test("custom creator voice rate changes billed coins without affecting global default path", () => {
  const globalVoiceRate = 10;
  const customVoiceRate = 45;
  const effectiveVoiceRate = resolveEffectiveRate(
    customVoiceRate,
    globalVoiceRate,
    60
  );
  const globalBilling = computeMaleCallCost({
    durationSeconds: 60,
    type: "voice",
    ratePerMinute: globalVoiceRate,
  });
  const customBilling = computeMaleCallCost({
    durationSeconds: 60,
    type: "voice",
    ratePerMinute: effectiveVoiceRate,
  });

  assert.equal(effectiveVoiceRate, 45);
  assert.equal(globalBilling.maleCost, 10);
  assert.equal(customBilling.maleCost, 45);
});

test("no custom rate resolves to global rate (backward compatible billing path)", () => {
  const globalSettings = {
    voiceRatePerMinute: 10,
    videoRatePerMinute: 60,
  };

  const voiceRate = resolveEffectiveRate(
    null,
    globalSettings.voiceRatePerMinute,
    60
  );
  const videoRate = resolveEffectiveRate(
    undefined,
    globalSettings.videoRatePerMinute,
    60
  );

  assert.equal(voiceRate, 10);
  assert.equal(videoRate, 60);

  const voiceBilling = computeMaleCallCost({
    durationSeconds: 60,
    type: "voice",
    ratePerMinute: voiceRate,
  });
  const videoShortBilling = computeMaleCallCost({
    durationSeconds: 20,
    type: "video",
    ratePerMinute: videoRate,
  });
  const videoLongBilling = computeMaleCallCost({
    durationSeconds: 45,
    type: "video",
    ratePerMinute: videoRate,
  });

  assert.equal(voiceBilling.maleCost, 10);
  assert.equal(videoShortBilling.maleCost, 30);
  assert.equal(videoShortBilling.minutes, 0.5);
  assert.equal(videoLongBilling.maleCost, 60);
  assert.equal(videoLongBilling.minutes, 1);
});

test("legacy earnings math unchanged for global rate creators", () => {
  const coinValue = 69 / 160;
  const maleCost = 60;
  const creatorPercentage = 50;

  const earnings = computeCreatorEarnings({
    maleCost,
    coinValue,
    creatorPercentage,
  });

  const revenue = Number((maleCost * coinValue).toFixed(2));
  const femaleAmount = Number((revenue * 0.5).toFixed(2));
  const platformAmount = Number((revenue - femaleAmount).toFixed(2));
  const femaleEarn = Math.floor(maleCost * 0.5);

  assert.equal(earnings.femaleEarn, femaleEarn);
  assert.equal(earnings.femaleAmount, femaleAmount);
  assert.equal(earnings.revenue, revenue);
  assert.equal(earnings.platformAmount, platformAmount);
  assert.equal(earnings.femaleEarningPercentage, 50);
});

test("custom percentage only still uses global voice/video rates", () => {
  const globalVoice = 10;
  const globalVideo = 60;

  const voiceRate = resolveEffectiveRate(null, globalVoice, 60);
  const videoRate = resolveEffectiveRate(null, globalVideo, 60);

  const billing = computeMaleCallCost({
    durationSeconds: 120,
    type: "voice",
    ratePerMinute: voiceRate,
  });
  const earnings = computeCreatorEarnings({
    maleCost: billing.maleCost,
    coinValue: 69 / 160,
    creatorPercentage: 80,
  });

  assert.equal(billing.maleCost, 20);
  assert.equal(earnings.femaleEarn, 16);
  assert.equal(earnings.femaleEarningPercentage, 80);
});
