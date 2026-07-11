import api from "./api";

export async function createVideoCall(receiverId: number) {
  const { data } = await api.post("/call/create", {
    receiverId,
  });

  return data;
}