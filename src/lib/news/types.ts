export type Story = {
  id: string;
  source?: string;
  kicker: string;
  title: string;
  summary: string;
  url?: string;
  imageUrl?: string;
  imageFloat?: "left" | "right";
  publishDate?: string;
  pageRef?: string;
  featured?: boolean;
  popularity?: number;
  isPlaceholder?: boolean;
  breaking?: boolean;
};

export type Section = {
  label: string;
  stories: Story[];
};

export type Edition = {
  meta?: Record<string, unknown>;
  sections: Section[];
};

export type AdapterQuery = {
  q?: string;
};

export type NewsAdapter = (query: AdapterQuery) => Promise<Edition>;
