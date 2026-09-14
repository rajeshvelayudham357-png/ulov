export const CALL_GIFTS = [
  {
    id: "red_heart",
    title: "Red Heart",
    coins: 9,
    emoji: "❤️",
  },
  {
    id: "lollipop",
    title: "Lollipop",
    coins: 15,
    emoji: "🍭",
  },
  {
    id: "sweet_kiss",
    title: "Sweet Kiss",
    coins: 19,
    emoji: "💋",
  },
  {
    id: "ice_cream",
    title: "Ice Cream",
    coins: 29,
    emoji: "🍦",
  },
  {
    id: "cute_bunny",
    title: "Cute Bunny",
    coins: 39,
    emoji: "🐰",
  },
  {
    id: "heart_balloon",
    title: "Heart Balloon",
    coins: 49,
    emoji: "🎈",
  },
  {
    id: "love_letter",
    title: "Love Letter",
    coins: 59,
    emoji: "💌",
  },
  {
    id: "cute_teddy",
    title: "Cute Teddy",
    coins: 79,
    emoji: "🧸",
  },
  {
    id: "sending_hugs",
    title: "Sending Hugs",
    coins: 99,
    emoji: "🤗",
  },
  {
    id: "birthday_cake",
    title: "Birthday Cake",
    coins: 129,
    emoji: "🎂",
  },
  {
    id: "chocolate_box",
    title: "Chocolate Box",
    coins: 149,
    emoji: "🍫",
  },
  {
    id: "sweet_perfume",
    title: "Sweet Perfume",
    coins: 179,
    emoji: "💐",
  },
  {
    id: "roses_for_you",
    title: "Roses For You",
    coins: 199,
    emoji: "🌹",
  },
  {
    id: "sunflower",
    title: "Sunflower",
    coins: 249,
    emoji: "🌻",
  },
  {
    id: "love_song",
    title: "Love Song",
    coins: 299,
    emoji: "🎵",
  },
  {
    id: "rainbow",
    title: "Rainbow",
    coins: 349,
    emoji: "🌈",
  },
  {
    id: "unicorn",
    title: "Magical Unicorn",
    coins: 399,
    emoji: "🦄",
  },
  {
    id: "i_like_you",
    title: "I Like You",
    coins: 499,
    emoji: "😍",
  },
  {
    id: "champagne",
    title: "Champagne",
    coins: 599,
    emoji: "🍾",
  },
  {
    id: "diamond_ring",
    title: "Diamond Ring",
    coins: 799,
    emoji: "💍",
  },
  {
    id: "fireworks",
    title: "Fireworks",
    coins: 999,
    emoji: "🎆",
  },
  {
    id: "sports_car",
    title: "Sports Car",
    coins: 1499,
    emoji: "🏎️",
  },
  {
    id: "helicopter",
    title: "Helicopter",
    coins: 1999,
    emoji: "🚁",
  },
  {
    id: "luxury_yacht",
    title: "Luxury Yacht",
    coins: 2999,
    emoji: "🛥️",
  },
  {
    id: "private_jet",
    title: "Private Jet",
    coins: 3999,
    emoji: "✈️",
  },
  {
    id: "royal_crown",
    title: "Royal Crown",
    coins: 4999,
    emoji: "👑",
  },
  {
    id: "super_rocket",
    title: "Super Rocket",
    coins: 6999,
    emoji: "🚀",
  },
  {
    id: "fairy_castle",
    title: "Fairy Castle",
    coins: 9999,
    emoji: "🏰",
  },
  {
    id: "galaxy_love",
    title: "Galaxy Love",
    coins: 14999,
    emoji: "🌌",
  },
];

export const FEMALE_GIFT_EARN_PERCENT = 25;

export const getCallGiftById = (giftId) =>
  CALL_GIFTS.find((gift) => gift.id === giftId) ?? null;
