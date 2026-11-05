// Shelters visitors can donate to in a pet's memory. Donations go straight to the
// shelter's own donation page; Starlight Garden never handles the money.
// Checked 5 November 2026. To add a shelter, add an entry here.

export type Shelter = {
  id: string;
  name: string;
  blurb: string;
  url: string;
  /** Registered Institution of a Public Character: donations can be tax-deductible. */
  ipc: boolean;
  animals: "dogs" | "cats" | "all";
};

export const SHELTERS: Shelter[] = [
  {
    id: "sosd",
    name: "Save Our Street Dogs (SOSD)",
    blurb: "Rescues, rehabilitates and rehomes Singapore's street dogs.",
    url: "https://www.sosd.org.sg/donation/",
    ipc: true,
    animals: "dogs",
  },
  {
    id: "asd",
    name: "Action for Singapore Dogs (ASD)",
    blurb: "Rescues, rehabilitates and rehomes abandoned dogs.",
    url: "https://www.asdsingapore.com/donate",
    ipc: false,
    animals: "dogs",
  },
  {
    id: "cws",
    name: "Cat Welfare Society (CWS)",
    blurb: "Works for the welfare of Singapore's community cats.",
    url: "https://www.catwelfare.org/donations/",
    ipc: true,
    animals: "cats",
  },
];

export function getShelter(id: unknown): Shelter | null {
  return SHELTERS.find((s) => s.id === id) ?? null;
}

/** Shelters to show for a pet: the keeper's choice first, then ones that match the kind of pet. */
export function sheltersFor(kind: string, chosen: string | null): Shelter[] {
  const group = kind === "Dog" ? "dogs" : kind === "Cat" ? "cats" : null;
  const matching = SHELTERS.filter((s) => s.animals === "all" || !group || s.animals === group);
  const list = matching.length ? matching : SHELTERS;
  const pick = getShelter(chosen);
  if (!pick) return list;
  return [pick, ...list.filter((s) => s.id !== pick.id)];
}
