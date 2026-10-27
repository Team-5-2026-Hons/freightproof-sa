// HashScan links for Hedera topics. The base is per-environment (testnet vs mainnet).
const DEFAULT_HASHSCAN_BASE = 'https://hashscan.io/testnet'

const NO_TOPIC = 'None'

/** True only for a real Hedera topic id: not null, not empty, not the 'None' placeholder. */
export function isAnchoredTopic(topicId: string | null | undefined): topicId is string {
  return !!topicId && topicId !== NO_TOPIC
}

export function hashscanTopicUrl(topicId: string): string {
  const base = process.env.NEXT_PUBLIC_HEDERA_HASHSCAN_BASE ?? DEFAULT_HASHSCAN_BASE
  return `${base}/topic/${topicId}`
}
