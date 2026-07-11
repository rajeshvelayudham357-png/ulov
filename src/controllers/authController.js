import {
    User
  } from "../models/index.js";
  
  
  
  
  // =====================
  // SEND OTP
  // =====================
  
  
  export const sendOtp =
  async (req,res)=>{
  
  
  try{
  
  
  const {
   phone
  }=req.body;
  
  
  
  console.log(
  "OTP SENT",
  phone
  );
  
  
  
  return res.json({
  
  message:
  "OTP sent successfully",
  
  otp:
  "123456"
  
  });
  
  
  
  }catch(error){
  
  
  return res.status(500)
  .json({
  
  message:
  error.message
  
  });
  
  
  }
  
  
  };
  
  
  
  
  
  
  
  
  
  // =====================
  // VERIFY OTP
  // =====================
  
  
  export const verifyOtp =
  async(req,res)=>{
  
  
  try{
  
  
  const {
   phone,
   otp
  }=req.body;
  
  
  
  
  
  // =====================
  // VALIDATE OTP
  // =====================
  
  
  if(
  otp !== "123456"
  ){
  
  
  return res
  .status(400)
  .json({
  
  message:
  "Invalid OTP"
  
  });
  
  
  }
  
  
  
  
  
  
  // =====================
  // FIND USER
  // =====================
  
  
  let user =
  await User.findOne({
  
  where:{
  
  phone
  
  }
  
  });
  
  
  
  
  
  
  // =====================
  // NEW USER CREATE
  // =====================
  
  
  if(!user){
  
  
  user =
  await User.create({
  
  
  phone,
  
  
  username:
  "User"+Date.now(),
  
  
  verified:
  false,
  
  
  online:
  false,
  
  
  profileCompleted:
  false
  
  
  });
  
  
  }
  
  
  
  
  
  
  // =====================
  // RETURN USER DATA
  // =====================
  
  
  return res.json({
  
  
  user:{
  
  
  id:
  user.id,
  
  
  phone:
  user.phone,
  
  
  username:
  user.username,
  
  
  name:
  user.name,
  
  
  avatar:
  user.avatar,
  
  
  gender:
  user.gender,
  
  
  bio:
  user.bio,
  
  
  age:
  user.age,
  
  
  languages:
  user.languages,
  
  
  interests:
  user.interests,
  
  
  preferredAge:
  user.preferredAge,
  
  
  verificationType:
  user.verificationType,
  
  
  audioVerified:
  user.audioVerified,
  
  
  videoVerified:
  user.videoVerified,
  
  
  verified:
  user.verified,
  
  
  online:
  user.online,
  
  
  // IMPORTANT FIX
  profileCompleted:
  user.profileCompleted
  
  
  }
  
  
  });
  
  
  
  
  
  
  }catch(error){
  
  
  
  console.log(
  "VERIFY OTP ERROR",
  error
  );
  
  
  
  return res.status(500)
  .json({
  
  message:
  error.message
  
  });
  
  
  
  }
  
  
  
  };