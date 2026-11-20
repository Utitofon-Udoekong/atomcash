import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@solidcash/solidcash",
    "@solidcash/solidhat",
    "@bitauth/libauth",
    "@noble/curves",
  ],
};

export default nextConfig;
