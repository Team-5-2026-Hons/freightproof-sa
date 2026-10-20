// HashScan links for Hedera topics. The base is per-environment (testnet vs mainnet).
const DEFAULT_HASHSCAN_BASE = 'https://hashscan.io/testnet'

export function hashscanTopicUrl(topicId: string): string {
  const base = process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? DEFAULT_HASHSCAN_BASE
  return `${base}/topic/${topicId}`
}
