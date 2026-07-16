export const GOLD_PACKAGES = [
  { id: 1, coins: 40, price: 19 },
  { id: 2, coins: 80, price: 39 },
  { id: 3, coins: 160, price: 69 },
  { id: 4, coins: 320, price: 129 },
  { id: 5, coins: 640, price: 249 },
  { id: 6, coins: 1040, price: 389 },
  { id: 7, coins: 2100, price: 699 },
  { id: 8, coins: 5000, price: 1499 },
];

export const getGoldPackageById = (packageId) =>
  GOLD_PACKAGES.find(
    (item) => item.id === Number(packageId)
  );
