export type StageKind = 'registration' | 'qualifying' | 'final' | 'results';
export type SubscriptionStatus = 'interested' | 'registered' | 'done' | 'dropped';

export interface Stage {
  id: string;
  kind: StageKind;
  starts_at: string;
  ends_at?: string | null;
  region_code?: string | null;
  format?: 'online' | 'offline' | 'hybrid';
}

export interface Olympiad {
  id: string;
  title: string;
  organizer: string;
  subjects: string[];
  grade_from: number;
  grade_to: number;
  rsosh_level: 1 | 2 | 3 | null;
  format: 'online' | 'offline' | 'hybrid';
  benefits_note: string;
  description?: string;
  url: string;
  source_url: string;
  verified_at: string;
  is_demo?: boolean;
  stages: Stage[];
}

export interface Profile {
  grade: number;
  subjects: string[];
  region_code: string;
  timezone: string;
  quiet_from: string;
  quiet_to: string;
}

export interface Subscription {
  id: string;
  olympiad_id: string;
  status: SubscriptionStatus;
}

export interface Filters {
  subject: string;
  grade: string;
  level: string;
  format: string;
}
