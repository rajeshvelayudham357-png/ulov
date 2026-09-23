let onlineUsersRef = null;

export const initSocketPresence = (onlineUsers) => {
  onlineUsersRef = onlineUsers;
};

export const getSocketConnectedUserIdSet = () => {
  if (!onlineUsersRef) {
    return new Set();
  }

  return new Set(
    [...onlineUsersRef.keys()].map((userId) => String(userId))
  );
};

export const getSocketConnectionCount = () =>
  onlineUsersRef ? onlineUsersRef.size : 0;
