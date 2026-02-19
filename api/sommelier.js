const admin = require('firebase-admin');

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

const LANG_MAP = { ca: 'CATALÀ', es: 'CASTELLANO', en: 'ENGLISH', fr: 'FRANÇAIS' };
const MAX_VINS_CONTEXT = 25;

// ─── 1. CORRECTOR DE TYPOS (Levenshtein fuzzy) ───────────────────────────────
// Vocabulari de referència: totes les paraules clau que el sistema ha d'entendre.
// Quan l'usuari escriu "xatto", "perceves" o "paeja", les corregim automàticament.
const VOCABULARI = [
  // Plats catalans i espanyols
  'xato', 'paella', 'fideuà', 'calçots', 'escalivada', 'escudella', 'canelons',
  'botifarra', 'sobrassada', 'croquetes', 'gazpacho', 'cocido', 'fabada',
  'suquet', 'cassola', 'estofat', 'arròs',
  // Peixos i marisc
  'percebes', 'bacallà', 'salmó', 'llagosta', 'gambes', 'musclo', 'ostra',
  'calamar', 'sèpia', 'pop', 'lluc', 'llobarró', 'rap', 'navalla',
  // Carns
  'vedella', 'conill', 'costelles', 'entrecot', 'chuletón', 'pollastre',
  'ànec', 'pato', 'pavo', 'xai', 'porc', 'botifarra', 'foie',
  // Ingredients
  'trufa', 'bolets', 'formatge', 'pasta', 'risotto', 'pizza',
  // Verbs i intencions
  'maridar', 'maridatge', 'recomanar', 'suggereix', 'acompanyar', 'maridaje',
  // Varietats de raïm
  'tempranillo', 'garnacha', 'cabernet', 'chardonnay', 'riesling',
  'albariño', 'syrah', 'merlot', 'pinot', 'moscatel',
];

// Normalitzem accents per comparar sense diferenciar é/e, à/a, etc.
function normalitzar(s) {
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, ''); // elimina diacrítics
}

// Distància de Levenshtein entre dues cadenes
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}

// Índex normalitzat del vocabulari (calculat una sola vegada)
const VOCABULARI_NORM = VOCABULARI.map(w => ({ original: w, norm: normalitzar(w) }));

function corregirToken(token) {
  const norm = normalitzar(token);

  // Paraules curtes (≤3 lletres): no corregim, massa risc de falsos positius
  if (norm.length <= 3) return token;

  // Primer mirem si ja coincideix exactament amb alguna paraula del vocabulari
  const exacte = VOCABULARI_NORM.find(v => v.norm === norm);
  if (exacte) return exacte.original;

  // Busquem la paraula del vocabulari més propera
  let millorParaula = null;
  let millorDist = Infinity;

  for (const { original, norm: vnorm } of VOCABULARI_NORM) {
    // Optimització: descartem si la diferència de longitud ja supera el llindar
    if (Math.abs(norm.length - vnorm.length) > 2) continue;
    const dist = levenshtein(norm, vnorm);
    if (dist < millorDist) { millorDist = dist; millorParaula = original; }
  }

  // Llindar dinàmic: 1 error per cada 4 lletres (ex: "xatto"→dist 1, "paeja"→dist 2)
  const llindar = Math.floor(norm.length / 4) + 1;
  return (millorDist <= llindar && millorParaula) ? millorParaula : token;
}

function corregirTypos(text) {
  return text
    .split(/(\s+)/)
    .map(token => /\s/.test(token) ? token : corregirToken(token))
    .join('');
}

// ─── 2. DETECCIÓ D'INTENCIÓ ───────────────────────────────────────────────────
function detectarIntencio(p) {
  const text = p.toLowerCase();

  const indicadorsVi = [
    'quin vi és', 'que és', 'explica', 'descriu', 'caracteristiques',
    'info sobre', 'parla de', "m'agrada", 'he provat', 'he begut',
    'anyada', 'merlot', 'cabernet', 'garnacha', 'tempranillo',
    'chardonnay', 'riesling', 'syrah', 'pinot',
  ];

  const indicadorsPlat = [
    'xato', 'xató', 'paella', 'cocido', 'gazpacho', 'tortilla', 'pulpo',
    'jamón', 'fabada', 'escalivada', 'fideuà', 'calçots', 'morcilla',
    'croquetes', 'botifarra', 'conill', 'costelles', 'bacallà', 'salmó',
    'rap', 'lluc', 'llobarró', 'percebes', 'navalla', 'musclo', 'ostra',
    'gamba', 'llagosta', 'sèpia', 'pop', 'calamar', 'pizza', 'pasta',
    'risotto', 'chuletón', 'entrecot', 'filet', 'vedella', 'porc', 'xai',
    'ànec', 'pato', 'pavo', 'pollastre', 'foie', 'trufa', 'bolets', 'formatge',
    'sobrassada', 'escudella', 'canelons', 'suquet', 'arròs', 'cassola',
    'estofat', 'guisat', 'peix', 'marisc',
  ];

  const indicadorsMaridatge = [
    'maridatge', 'maridar', 'maridaje', 'acompanyar', 'acompañar',
    'per menjar', 'per sopar', 'per dinar', 'per acompanyar',
    'quin vi per', 'quins vins per', 'recomanació', 'recomanar',
    'suggereix', 'recomienda', 'recomana',
  ];

  if (indicadorsPlat.some(k => text.includes(k))) return 'plat';
  if (indicadorsMaridatge.some(k => text.includes(k))) return 'maridatge';
  if (indicadorsVi.some(k => text.includes(k))) return 'vi';
  return 'maridatge';
}

// ─── 2. MAPPER — sense botiga, sense camps innecessaris ───────────────────────
// Retorna la DO real o string buit si és un nom de botiga
function netejaDO(do_raw) {
  if (!do_raw) return '';
  const d = do_raw.toLowerCase();
  // Si conté paraules de botiga, descartem el valor
  const esBotigaOInvalid = ['viniteca', 'vila', 'botiga', 'shop', 'store', 'bodega'].some(k => d.includes(k));
  return esBotigaOInvalid ? '' : do_raw;
}

function mapVi(d) {
  return {
    nom:    d.nom    || '',
    do:     netejaDO(d.do),
    preu:   d.preu   || null,
    imatge: d.imatge || '',
    // NO incloem: botiga, data_pujada, tipus, ni cap altre camp
  };
}

// ─── 3. QUERIES FIREBASE ──────────────────────────────────────────────────────

// Mostra general variada (per a maridatge i plat)
async function buscarVinsGeneral() {
  const [snap1, snap2] = await Promise.all([
    db.collection('cercavins').orderBy('nom').limit(MAX_VINS_CONTEXT).get(),
    db.collection('cercavins').orderBy('preu', 'desc').limit(MAX_VINS_CONTEXT).get(),
  ]);

  const map = new Map();
  [...snap1.docs, ...snap2.docs].forEach(doc => {
    const d = doc.data();
    if (d.imatge && !map.has(d.nom)) map.set(d.nom, mapVi(d));
  });

  return [...map.values()].sort(() => Math.random() - 0.5).slice(0, MAX_VINS_CONTEXT);
}

// Cerca per vi concret: carrega un bloc gran i filtra en memòria per substring
// Això evita el problema de que "Cune" apareix a la meitat del nom complet
async function buscarViConcret(pregunta) {
  const stopWords = new Set([
    'que', 'és', 'el', 'la', 'un', 'una', 'del', 'de', 'em', 'pot',
    'pots', 'per', 'i', 'les', 'els', 'quin', 'quina', 'sobre',
    'vull', 'saber', 'parla', 'explica', 'descriu', 'vi', 'vino', 'wine',
  ]);
  const paraules = pregunta
    .toLowerCase()
    .split(/[\s,.!?]+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Carreguem un bloc ampli i filtrem en memòria (Firestore no té full-text search)
  const snap = await db.collection('cercavins')
    .orderBy('nom')
    .limit(200) // Límit prou gran per cobrir la majoria de la col·lecció
    .get();

  const tots = snap.docs.map(doc => mapVi(doc.data())).filter(v => v.imatge && v.nom);

  // Filtrem: el nom del vi ha de contenir alguna de les paraules clau
  const coincidencies = tots.filter(v => {
    const nomLower = v.nom.toLowerCase();
    return paraules.some(p => nomLower.includes(p));
  });

  // Si no hi ha coincidències, retornem una mostra general per a que la IA triï
  if (coincidencies.length === 0) {
    return tots.sort(() => Math.random() - 0.5).slice(0, 15);
  }

  return coincidencies.slice(0, 15);
}

// ─── 4. RECONCILIACIÓ D'IMATGES — lookup per substring bidireccional ─────────
// Problema: Firebase té "Cune Monopole Clásico 2022" però la IA pot retornar "Cune Monopole"
// Solució: busquem si el nom de la IA és substring del nom de la BD, o viceversa

function reconciliarImatges(resultatIA, vinsDisponibles) {
  // Construïm índex: nom en minúscules → imatge
  const index = vinsDisponibles
    .filter(v => v.imatge && v.nom)
    .map(v => ({ nomLower: v.nom.toLowerCase().trim(), imatge: v.imatge, nom: v.nom }));

  const trobarImatge = (nomIA) => {
    if (!nomIA) return '';
    const nLower = nomIA.toLowerCase().trim();

    // 1. Match exacte
    const exacte = index.find(v => v.nomLower === nLower);
    if (exacte) return exacte.imatge;

    // 2. Substring: el nom de la IA està contingut dins el nom de la BD
    //    ex: "Cune Monopole" → troba "Cune Monopole Clásico 2022"
    const subIA = index.find(v => v.nomLower.includes(nLower) && nLower.length > 4);
    if (subIA) return subIA.imatge;

    // 3. Substring invers: el nom de la BD està contingut dins el nom de la IA
    //    ex: la IA retorna el nom complet però la BD el té abreviat
    const subBD = index.find(v => nLower.includes(v.nomLower) && v.nomLower.length > 4);
    if (subBD) return subBD.imatge;

    // 4. Paraules clau: comptem paraules en comú (mínim 2 per evitar falsos positius)
    const paraulesIA = nLower.split(/\s+/).filter(w => w.length > 3);
    let millorScore = 0;
    let millorImatge = '';
    index.forEach(v => {
      const paruelesBD = v.nomLower.split(/\s+/);
      const score = paraulesIA.filter(p => paruelesBD.some(b => b.includes(p) || p.includes(b))).length;
      if (score >= 2 && score > millorScore) {
        millorScore = score;
        millorImatge = v.imatge;
      }
    });
    if (millorImatge) return millorImatge;

    return ''; // No trobat → el frontend mostrarà el fallback
  };

  // Apliquem a vi_principal
  if (resultatIA.vi_principal) {
    resultatIA.vi_principal.imatge = trobarImatge(resultatIA.vi_principal.nom);
  }

  // Apliquem a vins_recomanats
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
  const base = `Ets un sommelier expert. Respon SEMPRE en ${idioma}.
Respon ÚNICAMENT amb JSON vàlid. Cap text fora del JSON.
IMPORTANT: No mencions mai la botiga d'on prové el vi. Descriu només el vi, la seva DO i les seves característiques.`;

  // Passem NOMÉS nom, do, imatge i preu — sense botiga ni altres camps
  const vinsList = JSON.stringify(
    vins.map(v => ({ nom: v.nom, do: v.do, imatge: v.imatge, preu: v.preu }))
  );

  if (intencio === 'vi') {
    return {
      system: `${base}

L'usuari pregunta per un vi concret. Tasca:
1. Identifica el vi de la llista que millor coincideix (pot tenir anyada al nom, busca per marca/productor).
2. Escriu una descripció experta de ~120 paraules: DO, varietat, notes de tast, temperatura de servei, potencial d'envelliment.
3. Afegeix 2 suggeriments de plats per maridar.

FORMAT JSON OBLIGATORI:
{
  "tipus_resposta": "vi",
  "vi_principal": { "nom": "NOM EXACTE TAL COM APAREIX A LA LLISTA", "do": "...", "imatge": "URL EXACTA DE LA LLISTA" },
  "descripcio": "descripció experta en ${idioma}",
  "maridatge_suggerit": ["plat 1", "plat 2"]
}`,
      user: `Vins disponibles: ${vinsList}\n\nConsulta: "${pregunta}"\n\nAVÍS: El camp "nom" i "imatge" han de ser EXACTAMENT com apareixen a la llista, sense modificar ni una lletra.`,
    };
  }

  if (intencio === 'plat') {
    return {
      system: `${base}

L'usuari pregunta per un plat típic O per un ingredient/carn (pato, vedella, percebes...). Tasca:
1. Si és un PLAT TÍPIC amb nom propi (xato, paella, gazpacho...):
   - Explica breument el plat (~60 paraules): origen, ingredients principals, sabor i textura.
2. Si és un INGREDIENT/CARN (pato, vedella, percebes, pollastre...):
   - NO t'inventis un plat. Simplement descriu l'ingredient en 1-2 frases (ex: "El pato es una carn saborosa i versàtil").
3. Tria EXACTAMENT 3 vins de la llista que maridin perfectament, justificant cada elecció en 1 frase.

FORMAT JSON OBLIGATORI:
{
  "tipus_resposta": "plat",
  "plat": { "nom": "nom del plat o ingredient", "descripcio": "descripció breu en ${idioma}" },
  "vins_recomanats": [
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "1 frase en ${idioma}" },
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "1 frase en ${idioma}" },
    { "nom": "NOM EXACTE", "do": "...", "imatge": "URL EXACTA", "justificacio": "1 frase en ${idioma}" }
  ]
}`,
      user: `Vins disponibles: ${vinsList}\n\nConsulta: "${pregunta}"\n\nAVÍS: "nom" i "imatge" han de ser EXACTAMENT com apareixen a la llista.`,
    };
  }

  return {
    system: `${base}

L'usuari demana una recomanació de maridatge. Tasca:
1. Escriu una introducció experta (1-2 frases).
2. Tria EXACTAMENT 3 vins de la llista. Per a cada vi, escriu 1-2 frases justificant el maridatge.
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
    user: `Vins disponibles: ${vinsList}\n\nConsulta: "${pregunta}"\n\nAVÍS: "nom" i "imatge" han de ser EXACTAMENT com apareixen a la llista.`,
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

  if (!resp.ok) throw new Error(`Groq error ${resp.status}: ${await resp.text()}`);

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

  // Corregim typos ABANS de detectar intenció i buscar a Firebase
  const preguntaCorregida = corregirTypos(pregunta.trim());

  try {
    const intencio = detectarIntencio(preguntaCorregida);

    const vins = intencio === 'vi'
      ? await buscarViConcret(preguntaCorregida)
      : await buscarVinsGeneral();

    if (!vins || vins.length === 0) {
      return res.status(200).json({ error: 'No hem trobat vins a la base de dades.' });
    }

    // Passem la pregunta corregida a la IA perquè entengui millor el context
    const { system, user } = buildPrompt(intencio, idiomaReal, vins, preguntaCorregida);
    let resultat = await cridarGroq(system, user);
    resultat = reconciliarImatges(resultat, vins);

    return res.status(200).json({ resposta: resultat });

  } catch (error) {
    console.error('[sommelier] Error:', error.message);
    return res.status(500).json({ error: 'Error intern. Torna a intentar-ho.' });
  }
};
