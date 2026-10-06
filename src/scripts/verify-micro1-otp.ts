import "dotenv/config";
import { Micro1Client } from "../clients/micro1.client.js";

const otp = process.argv[2];
if (!otp) {
  console.error("Usage: tsx src/scripts/verify-micro1-otp.ts <otp>");
  process.exit(1);
}

const client = new Micro1Client();
const result = await client.verifyOtp(otp);
console.log(
  JSON.stringify({
    email: result.email,
    name: result.name,
    authenticated: Boolean(result.token),
  }),
);
