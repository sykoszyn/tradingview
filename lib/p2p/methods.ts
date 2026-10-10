// Métodos de pago que uso → cómo se reconocen en los anuncios de cada plataforma.
export interface PayMethod {
  id: string;
  label: string;
  match: RegExp;
  exclude?: RegExp;
}

export const PAY_METHODS: PayMethod[] = [
  { id: 'mercadopago', label: 'Mercado Pago', match: /mercado ?pago/ },
  { id: 'banco', label: 'Transferencia bancaria', match: /bank|banco|transfer|bna|galicia|santander|bbva|macro|provincia/, exclude: /brubank/ },
  { id: 'uala', label: 'Ualá', match: /uala|ualá/ },
  { id: 'brubank', label: 'Brubank', match: /brubank/ },
  { id: 'lemon', label: 'Lemon', match: /lemon/ },
  { id: 'naranjax', label: 'Naranja X', match: /naranja/ },
  { id: 'prex', label: 'Prex', match: /prex/ },
  { id: 'personalpay', label: 'Personal Pay', match: /personal ?pay/ },
  { id: 'belo', label: 'Belo', match: /belo/ },
  { id: 'fiwind', label: 'Fiwind', match: /fiwind/ },
  { id: 'cuentadni', label: 'Cuenta DNI', match: /cuenta ?dni/ },
];

/** ¿El método del anuncio (identificador + nombre, en minúsculas) corresponde a alguno de los míos? */
export function methodMatches(methodKey: string, mine: string[]): boolean {
  const k = methodKey.toLowerCase();
  return PAY_METHODS.some((m) => mine.includes(m.id) && m.match.test(k) && !(m.exclude && m.exclude.test(k)));
}

export const methodLabels = (ids: string[]) => PAY_METHODS.filter((m) => ids.includes(m.id)).map((m) => m.label);
