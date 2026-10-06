import "dotenv/config";
import { Micro1Client } from "../clients/micro1.client.js";

const client = new Micro1Client();
const result = await client.requestOtp();
console.log(
  JSON.stringify({
    email: result.email,
    isAlreadyRegistered: result.isAlreadyRegistered,
    hasOtpHash: Boolean(result.otpHash),
  }),
);
