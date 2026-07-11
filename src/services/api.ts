import axios from "axios";

export default axios.create({
  baseURL: "http://192.168.1.100:3001/api",
  timeout: 10000,
});