export type Category = 'gas_station' | 'travel_center' | 'rest_area';
export type Cleanliness = 'dirty' | 'okay' | 'very_clean' | 'unknown';
export type StallPrivacy = 'gaps' | 'full_doors' | 'single_user' | 'unknown';
export type KeyRequired = 'yes' | 'no' | 'unknown';
export type Food = 'none' | 'snacks' | 'hot_food' | 'unknown';
export type Restroom = 'mens' | 'womens' | 'all_gender' | 'unspecified';
export type ReportReason = 'fake_or_duplicate' | 'closed_or_not_public' | 'wrong_location' | 'spam_or_abuse' | 'personal_info' | 'other';

export const CATEGORY_LABEL: Record<Category, string> = {
  gas_station: 'Gas station',
  travel_center: 'Travel center',
  rest_area: 'Public rest area',
};

export const CLEANLINESS_LABEL: Record<Cleanliness, string> = { dirty: 'Dirty', okay: 'Okay', very_clean: 'Very clean', unknown: 'Not sure' };
export const PRIVACY_LABEL: Record<StallPrivacy, string> = { gaps: 'Gaps', full_doors: 'Full doors', single_user: 'Single-user room', unknown: 'Not sure' };
export const KEY_LABEL: Record<KeyRequired, string> = { yes: 'Key needed', no: 'No key needed', unknown: 'Not sure' };
export const KEY_OPTION_LABEL: Record<KeyRequired, string> = { yes: 'Yes', no: 'No', unknown: 'Not sure' };
export const FOOD_LABEL: Record<Food, string> = { none: 'No food', snacks: 'Snacks', hot_food: 'Hot food', unknown: 'Not sure' };
export const FOOD_OPTION_LABEL: Record<Food, string> = { none: 'None', snacks: 'Snacks', hot_food: 'Hot food', unknown: 'Not sure' };
export const RESTROOM_LABEL: Record<Restroom, string> = { mens: "Men's", womens: "Women's", all_gender: 'All-gender', unspecified: 'Not specified' };

export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  fake_or_duplicate: 'Fake or duplicate location',
  closed_or_not_public: 'Bathroom closed or not public',
  wrong_location: 'Incorrect map position',
  spam_or_abuse: 'Spam or abusive content',
  personal_info: 'Personal information',
  other: 'Other',
};

export const PLOP_SCALE: { plops: 1 | 2 | 3 | 4 | 5; title: string; text: string }[] = [
  { plops: 1, title: 'Avoid if you can', text: 'Feels dirty or unsafe to use, or you need to ask for a key.' },
  { plops: 2, title: 'In a pinch', text: 'Usable if you have to, with significant shortcomings.' },
  { plops: 3, title: 'Ordinary stop', text: 'A typical gas-station bathroom. Clean enough to use without feeling gross.' },
  { plops: 4, title: 'Nice stop', text: 'Notably clean and comfortable, with good privacy.' },
  { plops: 5, title: 'A proper 5-plopper', text: 'Exceptionally clean, with full stall doors. A throne away from home.' },
];

export function scoreTone(score: number | null | undefined): 'great' | 'good' | 'meh' | 'none' {
  if (score == null) return 'none';
  if (score >= 4) return 'great';
  if (score >= 3) return 'good';
  return 'meh';
}
