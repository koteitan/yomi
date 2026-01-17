export interface Profile {
  pubkey: string;
  name?: string;
  display_name?: string;
  picture?: string;
}

export interface NoteEvent {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  tags: string[][];
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
    };
  }
}
