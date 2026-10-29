import assert from "node:assert/strict";
import test from "node:test";

import { maskChatMessage } from "../../utils/chatMessageFilter.util.js";

test("leaves a normal message unchanged", () => {
  const result = maskChatMessage("Hi, are you free at 10:30 tonight?");

  assert.equal(result.text, "Hi, are you free at 10:30 tonight?");
  assert.equal(result.masked, false);
  assert.deepEqual(result.reasons, []);
});

test("masks a plain 10-digit phone number", () => {
  const result = maskChatMessage("call me 9876543210");

  assert.equal(result.text, "call me **********");
  assert.deepEqual(result.reasons, ["contact_number"]);
});

test("masks phone numbers split with spaces, dashes and country code", () => {
  assert.equal(
    maskChatMessage("my no +91 98765 43210").text,
    "my no +** ***** *****"
  );
  assert.equal(
    maskChatMessage("98765-43210 ok").text,
    "*****-***** ok"
  );
  assert.equal(
    maskChatMessage("(987) 654.3210").text,
    "(***) ***.****"
  );
});

test("masks numbers written as words", () => {
  const result = maskChatMessage("nine eight seven six five call");

  assert.equal(result.text, "**** ***** ***** *** **** call");
  assert.deepEqual(result.reasons, ["contact_number"]);
});

test("masks numbers mixing digits and words", () => {
  assert.equal(
    maskChatMessage("98 seven 65 four").text,
    "** ***** ** ****"
  );
});

test("does not mask short numbers like times, prices or years", () => {
  assert.equal(maskChatMessage("call at 9 pm, 2026").masked, false);
  assert.equal(maskChatMessage("I paid 500 coins").masked, false);
  assert.equal(maskChatMessage("date 29/10/2026").masked, false);
});

test("masks bad words keeping their length", () => {
  const result = maskChatMessage("you are a bitch");

  assert.equal(result.text, "you are a *****");
  assert.deepEqual(result.reasons, ["bad_word"]);
});

test("masks bad words with repeats, case and leetspeak", () => {
  assert.equal(maskChatMessage("FUUUCK off").text, "****** off");
  assert.equal(maskChatMessage("sh1t").text, "****");
  assert.equal(maskChatMessage("b!tch").text, "*****");
});

test("masks bad words inside longer words", () => {
  assert.equal(maskChatMessage("motherfucker").text, "************");
});

test("masks spaced-out bad words", () => {
  assert.equal(maskChatMessage("f u c k you").text, "******* you");
  assert.equal(maskChatMessage("s.h.i.t").text, "*******");
});

test("masks regional abusive words", () => {
  assert.equal(maskChatMessage("chutiya").text, "*******");
  assert.equal(maskChatMessage("madarchod hai").text, "********* hai");
});

test("does not mask innocent words that contain short bad words", () => {
  assert.equal(maskChatMessage("classic assistant").masked, false);
  assert.equal(maskChatMessage("grandiose applauded").masked, false);
  assert.equal(maskChatMessage("Scunthorpe").masked, false);
  assert.equal(maskChatMessage("as soon as you can").masked, false);
});

test("masks both a number and a bad word in one message", () => {
  const result = maskChatMessage("bitch call 9876543210");

  assert.equal(result.text, "***** call **********");
  assert.deepEqual(result.reasons.sort(), ["bad_word", "contact_number"]);
});

test("masks direct threats", () => {
  const result = maskChatMessage("i will kill you");

  assert.equal(result.text, "***************");
  assert.deepEqual(result.reasons, ["harassment"]);

  assert.equal(maskChatMessage("I'll kill u").text, "***********");
  assert.equal(maskChatMessage("gonna stab you tonight").text, "gonna ******** tonight");
  assert.equal(maskChatMessage("go die").text, "******");
  assert.equal(maskChatMessage("kys").text, "***");
});

test("masks stalking and intimidation", () => {
  assert.equal(
    maskChatMessage("i know where you live").text,
    "*********************"
  );
  assert.equal(maskChatMessage("i will find you").text, "***************");
  assert.equal(
    maskChatMessage("i will come to your house").text,
    "i will ******************"
  );
  assert.equal(
    maskChatMessage("you will regret this").text,
    "you *********** this"
  );
});

test("masks sexual harassment and threats to leak media", () => {
  assert.equal(maskChatMessage("send me nudes").text, "*************");
  assert.equal(
    maskChatMessage("show me your body").text,
    "*****************"
  );
  assert.equal(
    maskChatMessage("take off your clothes").text,
    "*********************"
  );
  assert.equal(
    maskChatMessage("i will leak your photos").text,
    "i will ****************"
  );
});

test("masks violent words on their own", () => {
  assert.equal(maskChatMessage("rape").text, "****");
  assert.equal(maskChatMessage("i will kidnap her").text, "************* her");
  assert.equal(maskChatMessage("acid attack").text, "***********");
  assert.equal(maskChatMessage("throw acid").text, "**********");
});

test("masks regional threats", () => {
  assert.equal(maskChatMessage("maar dunga").text, "**********");
  assert.equal(maskChatMessage("jaan se maar").text, "************");
});

test("does not mask everyday words that look like threats", () => {
  assert.equal(maskChatMessage("I love grapes and my therapist").masked, false);
  assert.equal(maskChatMessage("I will hit you up later").masked, false);
  assert.equal(maskChatMessage("I would never hurt you").masked, false);
  assert.equal(maskChatMessage("send me your photo please").masked, false);
  assert.equal(maskChatMessage("I will finish work and call").masked, false);
});

test("masks violence and weapon words on their own", () => {
  assert.equal(maskChatMessage("kill").text, "****");
  assert.equal(maskChatMessage("i have a knife").text, "i have a *****");
  assert.equal(maskChatMessage("bomb blast").text, "**** blast");
  assert.equal(maskChatMessage("got a gun").text, "got a ***");
  assert.equal(maskChatMessage("chaku leke aaunga").text, "***** leke aaunga");
  assert.equal(maskChatMessage("kathi eduthu varuven").text, "***** eduthu varuven");
  assert.deepEqual(maskChatMessage("knife").reasons, ["harassment"]);
});

test("masks Hindi bad words in Roman letters and Devanagari", () => {
  assert.equal(maskChatMessage("bhosdike").text, "********");
  assert.equal(maskChatMessage("tu kamina hai").text, "tu ****** hai");
  assert.equal(maskChatMessage("कमीना है तू").text, "***** है तू");
  assert.equal(maskChatMessage("मादरचोद").text, "*******");
  assert.equal(maskChatMessage("भोसड़ीके").masked, true);
});

test("masks Tamil and Thanglish bad words", () => {
  assert.equal(maskChatMessage("thevidiya paiya").text, "********* paiya");
  assert.equal(maskChatMessage("otha da").text, "**** da");
  assert.equal(maskChatMessage("poda punda").text, "poda *****");
  assert.equal(maskChatMessage("தேவடியா").masked, true);
  assert.equal(maskChatMessage("ஓத்தா போ").text, "***** போ");
});

test("masks Malayalam bad words in Roman letters and Malayalam script", () => {
  assert.equal(maskChatMessage("myre poda").text, "**** poda");
  assert.equal(maskChatMessage("pulayadimone").masked, true);
  assert.equal(maskChatMessage("മൈരേ").masked, true);
  assert.equal(maskChatMessage("പുലയാടി മോനെ").masked, true);
});

test("masks native-script threats", () => {
  assert.equal(maskChatMessage("चाकू").masked, true);
  assert.equal(maskChatMessage("मार डालूंगा").masked, true);
  assert.deepEqual(maskChatMessage("मार डालूंगा").reasons, ["harassment"]);
  assert.equal(maskChatMessage("கொல்லுவேன்").masked, true);
  assert.equal(maskChatMessage("കൊല്ലും").masked, true);
});

test("does not mask everyday regional words", () => {
  assert.equal(maskChatMessage("नमस्ते, कैसे हो?").masked, false);
  assert.equal(maskChatMessage("வணக்கம் எப்படி இருக்கீங்க").masked, false);
  assert.equal(maskChatMessage("സുഖമാണോ").masked, false);
  assert.equal(maskChatMessage("pool party in Kollam").masked, false);
  assert.equal(maskChatMessage("saapteengala").masked, false);
});

test("keeps emoji and other text intact", () => {
  assert.equal(
    maskChatMessage("hi 😊 9876543210 💖").text,
    "hi 😊 ********** 💖"
  );
});
