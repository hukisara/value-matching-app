import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  eslint: {
    // 警告が出てもビルドを続行する
    ignoreDuringBuilds: true,
  },
  typescript: {
    // 型エラーが出てもビルドを続行する
    ignoreBuildErrors: true,
  },
};

export default nextConfig;