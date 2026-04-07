export interface Room {
  id: string
  code: string
  status: 'waiting' | 'playing' | 'calculating' | 'result'
  host_id: string
  created_at: string
}

export interface Participant {
  id: string
  room_code: string
  user_id: string
  name: string
  answers: number[]
  is_finished: boolean
  created_at: string
}

// Supabase generated types helper
export interface Database {
  public: {
    Tables: {
      rooms: {
        Row: Room
        Insert: Omit<Room, 'id' | 'created_at'>
        Update: Partial<Omit<Room, 'id' | 'created_at'>>
      }
      participants: {
        Row: Participant
        Insert: Omit<Participant, 'id' | 'created_at'>
        Update: Partial<Omit<Participant, 'id' | 'created_at'>>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
