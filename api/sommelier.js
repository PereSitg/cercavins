const admin = require('firebase-admin');

// ─── Firebase init (singleton) ────────────────────────────────────────────────
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}
const db = admin.firestore();

// ─── Constants ────────────────────────────────────────────────────────────────
const LANG_MAP = { ca: 'CATALÀ', es: 'CASTELLANO', en: 'ENGLISH', fr: 'FRANÇAIS' };
const MAX_VINS_CONTEXT = 25;

// ─── 1. DETECCIÓ D'INTENCIÓ (sense IA, gratuït) ──────────────────────────────
function detectarIntencio(p) {
  const text = p.toLowerCase();

  const indicadorsVi = [
    'quin vi és', 'que és', 'explica', 'descriu', 'caracteristiques',
    'info sobre', 'parla de', "m'agrada", 'he provat', 'he begut',
    'anyada', 'merlot', 'cabernet', 'garnacha', 'tempranillo',
    'chardonnay', 'riesling', 'syrah', 'pinot',
  ];

  // Plats típics — incloem "xato" i altres plats catalans/mediterranis
  const indicadorsPlat = [
    'xato', 'xató', 'paella', 'cocido', 'gazpacho', 'tortilla', 'pulpo',
    'jamón', 'fabada', 'escalivada', 'fideuà', 'calçots', 'morcilla',
    'croquetes', 'botifarra', 'conill', 'costelles', 'bacallà', 'salmó',
    'rap', 'lluc', 'llobarró', 'percebes', 'navalla', 'musclo', 'ostra',
    'gamba', 'llagosta', 'sèpia', 'pop', 'calamar', 'pizza', 'pasta',
    'risotto', 'chuletón', 'entrecot', 'filet', 'vedella', 'porc', 'xai',
    'ànec', 'pollastre', 'foie', 'trufa', 'bolets', 'formatge',
    'sobrassada', 'escudella', 'canelons', 'suquet', 'arròs', 'cassola',
    'estofat', 'guisat', 'peix', 'marisc',
  ];

  const indicadorsMaridatge = [
    'maridatge', 'maridar', 'maridaje', 'acompanyar', 'acompañar',
    'per menjar', 'per sopar', 'per dinar', 'per acompanyar',
    'quin vi per', 'quins vins per', 'recomanació', 'recomanar',
    'suggereix', 'recomienda', 'recomana',
  ];

  const téIndicadorVi = indicadorsVi.some(k => text.includes(k));
  const téIndicadorPlat = indicadorsPlat.some(k => text.includes(k));
  const téIndicadorMaridatge = indicadorsMaridatge.some(k => text.includes(k));

  // Un plat sempre guanya (sigui o no amb "maridar")
  if (téIndicadorPlat) return 'plat';
  if (téIndicadorMaridatge) return 'maridatge';
  if (téIndicadorVi) return 'vi';
  return 'maridatge'; // Per defecte
}

// ─── 2. QUERIES FIREBASE ──────────────────────────────────────────────────────
// NOTA: La BD té tots els documents amb tipus:"vi" sense distinció blanc/negre/rosat.
// Per tant NO filtrem per tipus — carreguem mostres variades i deixem que la IA triï.

async function buscarVinsGeneral() {
  // Dues queries offsetades per tenir varietat de preus i noms
  const [snap1, snap2] = await Promise.all([
    db.collection('cercavins').orderBy('nom').limit(MAX_VINS_CONTEXT).get(),
    db.collection('cercavins').orderBy('preu', 'desc').limit(MAX_VINS_CONTEXT).get(),
  ]);

  const map = new Map();
  [...snap1.docs, ...snap2.docs].forEach(doc => {
    const d = doc.data();
    if (d.imatge && !map.has(d.nom)) {
      map.set(d.nom, mapVi(d));
    }
  });

  // Barregem per tenir varietat i tallem
  return [...map.values()].sort(() => Math.random() - 0.5).slice(0, MAX_VINS_CONTEXT);
}

async function buscarViConcret(pregunta) {
  const stopWords = new Set([
    'que', 'és', 'el', 'la', 'un', 'una', 'del', 'de', 'em', 'pot',
    'pots', 'per', 'i', 'les', 'els', 'quin', 'quina', 'sobre',
    'vull', 'saber', 'parla', 'explica', 'descriu',
  ]);
  const paraules = pregunta
    .toLowerCase()
    .split(/[\s,.!?]+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  const map = new Map();

  for (const paraula of paraules.slice(0, 4)) {
    const inicial = paraula.charAt(0).toUpperCase() + paraula.slice(1);
    try {
      const snap = await db.collection('cercavins')
        .orderBy('nom')
        .startAt(inicial)
        .endAt(inicial + '\uf8ff')
        .limit(5)
        .get();
      snap.docs.forEach(doc => {
        const d = doc.data();
        if (d.imatge) map.set(d.nom, mapVi(d));
      });
    } catch (e) { /* ignorem errors de query individual */ }
  }

  // Fallback: mostra general si no trobem res per nom
  if (map.size === 0) {
    const vinsGeneral = await buscarVinsGeneral();
    vinsGeneral.forEach(v => map.set(v.nom, v));
  }

  return [...map.values()].slice(0, 15);
}

// ─── 3. MAPPER DE DADES ───────────────────────────────────────────────────────
function mapVi(d) {
  return {
    nom: d.nom || '',
    do: d.do || '',
    tipus: d.tipus || '',
    preu: d.preu || null,
    imatge: d.imatge || '',
  };
}

// ─── 4. RECONCILIACIÓ D'IMATGES ROBUSTA (fuzzy match) ────────────────────────
function reconciliarImatges(resultatIA, vinsDisponibles) {
  const lookupExacte = {};
  const lookupFuzzy = [];

  vinsDisponibles.forEach(v => {
    if (v.imatge) {
      lookupExacte[v.nom.toLowerCase().trim()] = v;
      lookupFuzzy.push({ vi: v, paraules: v.nom.toLowerCase().split(/\s+/) });
    }
  });

  const trobarImatge = (nomIA) => {
    if (!nomIA) return '';
    const nomNorm = nomIA.toLowerCase().trim();

    // 1. Match exacte
    if (lookupExacte[nomNorm]) return lookupExacte[nomNorm].imatge;

    // 2. Match parcial: màxim de paraules en comú
    let millorMatch = null;
    let millorScore = 0;
    const paraulesIA = nomNorm.split(/\s+/).filter(w => w.length > 2);
    lookupFuzzy.forEach(({ vi, paraules }) => {
      const score = paraulesIA.filter(p =>
        paraules.some(vp => vp.includes(p) || p.includes(vp))
      ).length;
      if (score > millorScore) { millorScore = score; millorMatch = vi; }
    });

    return millorMatch && millorScore > 0 ? millorMatch.imatge : '';
  };

  if (resultatIA.vi_principal) {
    resultatIA.vi_principal.imatge = trobarImatge(resultatIA.vi_principal.nom);
  }
  if (Array.isArray(resultatIA.vins_recomanats)) {
    resultatIA.vins_recomanats = resultatIA.vins_recomanats.map(v => ({
      ...v,
      imatge: trobarImatge(v.nom),
    }));
  }

  return resultatIA;
}

// ─── 5. PROMPTS ───────────────────────────────────────────────────────────────
function buildPrompt(intencio, idioma, vins, pregunta) {
  const base = `Ets un sommelier expert. Respon SEMPRE en ${idioma}. Respon ÚNICAMENT amb JSON vàlid, sense cap text fora del JSON.`;

  // Passem nom, do, imatge i preu (mínim necessari) per no saturar el context
  const vinsList = JSON.stringify(
    vins.map(v => ({ nom: v.nom, do: v.do, imatge: v.imatge, preu: v.preu }))
  );

  if (intencio === 'vi') {
    return {
      system: `${base}

L'usuari pregunta per un vi concret o una marca. Tasca:
1. Identifica el vi de la llista que millor coincideix amb la consulta.
2. Escriu una descripció experta (~120 paraules): DO, varietat, notes de tast, temperatura de servei.
3. Afegeix 2 suggeriments de plats per maridar.

FORMAT JSON OBLIGATORI:
{
  "tipus_resposta": "vi",
  "vi_principal": { "nom": "NOM EXACTE DE LA LLISTA", "do": "...", "imatge": "URL EXACTA DE LA LLISTA" },
  "descripcio": "text en ${idioma}",
  "maridatge_suggerit": ["plat 1", "plat 2"]
}`,
      user: `Vins disponibles: ${vinsList}\n\nConsulta: "${pregunta}"\n\nEls camps "nom" i "imatge" han de ser EXACTAMENT com apareixen a la llista.`,
    };
  }

  if (intencio === 'plat') {
    return {
      system: `${base}

L'usuari pregunta per un plat típic. Tasca:
1. Explica breument el plat (~80 paraules): origen, ingredients principals, sabor, textura.
2. Tria EXACTAMENT 3 vins de la llista i justifica cada elecció en 1 frase.

FORMAT JSON OBLIGATORI:
{
  "tipus_resposta": "plat",
  "plat": { "nom": "nom del plat", "descripcio": "descripció en ${idioma}" },
  "vins_recomanats": [
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "frase en ${idioma}" },
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "frase en ${idioma}" },
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "frase en ${idioma}" }
  ]
}`,
      user: `Vins disponibles: ${vinsList}\n\nConsulta: "${pregunta}"\n\nEls camps "nom" i "imatge" han de ser EXACTAMENT com apareixen a la llista.`,
    };
  }

  // Maridatge (default)
  return {
    system: `${base}

L'usuari demana una recomanació de maridatge. Tasca:
1. Escriu una introducció experta (1-2 frases).
2. Tria EXACTAMENT 3 vins de la llista i justifica cada un en 1-2 frases.
3. Afegeix un consell de sommelier al final (màx 50 paraules).

FORMAT JSON OBLIGATORI:
{
  "tipus_resposta": "maridatge",
  "introduccio": "text en ${idioma}",
  "vins_recomanats": [
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "text en ${idioma}" },
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "text en ${idioma}" },
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "text en ${idioma}" }
  ],
  "consell_sommelier": "text en ${idioma}"
}`,
    user: `Vins disponibles: ${vinsList}\n\nConsulta: "${pregunta}"\n\nEls camps "nom" i "imatge" han de ser EXACTAMENT com apareixen a la llista.`,
  };
}

// ─── 6. CRIDA A GROQ ──────────────────────────────────────────────────────────
async function cridarGroq(systemPrompt, userPrompt) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 1000,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Groq error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('Groq no ha retornat contingut');
  return JSON.parse(raw);
}

// ─── 7. HANDLER PRINCIPAL ─────────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Mètode no permès' });

  const { pregunta, idioma } = req.body;
  if (!pregunta || pregunta.trim().length < 2) {
    return res.status(400).json({ error: 'Consulta massa curta' });
  }

  const idiomaReal = LANG_MAP[(idioma || 'ca').toLowerCase().slice(0, 2)] || 'CATALÀ';

  try {
    const intencio = detectarIntencio(pregunta);

    const vins = intencio === 'vi'
      ? await buscarViConcret(pregunta)
      : await buscarVinsGeneral();

    if (!vins || vins.length === 0) {
      return res.status(200).json({ error: 'No hem trobat vins a la base de dades.' });
    }

    const { system, user } = buildPrompt(intencio, idiomaReal, vins, pregunta);
    let resultat = await cridarGroq(system, user);
    resultat = reconciliarImatges(resultat, vins);

    return res.status(200).json({ resposta: resultat });

  } catch (error) {
    console.error('[sommelier] Error:', error.message);
    return res.status(500).json({ error: 'Error intern. Torna a intentar-ho.' });
  }
};
