import type { Cta, Section } from './content';
import { randomUUID } from './uuid';

export function duplicateSectionForNewIds(section: Section): Section {
  return {
    ...section,
    id: randomUUID(),
    image: { ...section.image },
    ctas: section.ctas.map(duplicateCtaForNewIds),
  };
}

function duplicateCtaForNewIds(cta: Cta): Cta {
  return {
    ...cta,
    id: randomUUID(),
    position: { ...cta.position },
    size: { ...cta.size },
    style: { ...cta.style },
    link: { ...cta.link },
    ...(cta.image ? { image: { ...cta.image } } : {}),
  };
}
