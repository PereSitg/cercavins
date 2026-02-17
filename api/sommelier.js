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
const MAX_VINS_CONTEXT = 20; // Màxim vins que passem al model per no saturar

// ─── 1. DETECCIÓ D'INTENCIÓ (sense IA, ràpid i gratuït) ─────────────────────
function detectarIntencio(p) {
  const text = p.toLowerCase();

  // Paraules clau que indiquen consulta sobre un vi concret
  const indicadorsVi = [
    'quin vi és', 'que és', 'explica', 'descriu', 'caracteristiques',
    'info sobre', 'parla', "m'agrada", 'he provat', 'he begut',
    'cune', 'ribera', 'priorat', 'rioja', 'albariño', 'cava', 'celler',
    'bodega', 'anyada', 'merlot', 'cabernet', 'garnacha', 'tempranillo',
    'chardonnay', 'riesling', 'syrah', 'pinot', 'blanc', 'negre', 'rosat',
    'espumós', 'dolç', 'sec',
  ];

  // Paraules clau que indiquen un plat típic (maridatge per plat)
  const indicadorsPlat = [
    'paella', 'cocido', 'gazpacho', 'tortilla', 'pulpo', 'jamón', 'fabada',
    'escalivada', 'fideuà', 'calçots', 'morcilla', 'croquetes', 'botifarra',
    'conill', 'costelles', 'bacallà', 'salmó', 'rap', 'lluc', 'llobarró',
    'percebes', 'navalla', 'musclo', 'ostra', 'gamba', 'llagosta', 'sèpia',
    'pop', 'calamar', 'pizza', 'pasta', 'risotto', 'chuletón', 'entrecot',
    'filet', 'vedella', 'porc', 'xai', 'ànec', 'pollastre', 'foie', 'trufa',
    'bolets', 'formatge', 'sobrassada', 'típic', 'tradicion', 'gastrono',
    'plat', 'cuina', 'menjar', 'recepta',
  ];

  // Paraules clau que indiquen maridatge directe
  const indicadorsMaridatge = [
    'maridatge', 'maridar', 'maridaje', 'acompanyar', 'acompañar',
    'per menjar', 'per sopar', 'per dinar', 'per acompanyar',
    'quin vi per', 'quins vins per', 'recomanació', 'recomanar',
    'suggereix', 'recomienda',
  ];

  const téIndicadorVi = indicadorsVi.some(k => text.includes(k));
  const téIndicadorPlat = indicadorsPlat.some(k => text.includes(k));
  const téIndicadorMaridatge = indicadorsMaridatge.some(k => text.includes(k));

  // Lògica de prioritat
  if (téIndicadorMaridatge && !téIndicadorPlat) return 'maridatge';
  if (téIndicadorPlat) return 'plat';
  if (téIndicadorVi && !téIndicadorMaridatge) return 'vi';
  return 'maridatge'; // Per defecte
}

// ─── 2. QUERIES FIREBASE OPTIMITZADES ────────────────────────────────────────
async function buscarViConcret(pregunta) {
  // Extraiem paraules significatives de la pregunta per filtrar
  const stopWords = new Set(['que', 'és', 'el', 'la', 'un', 'una', 'del', 'de', 'em', 'pot', 'pot', 'pots', 'per', 'i']);
  const paraules = pregunta
    .toLowerCase()
    .split(/[\s,.!?]+/)
    .filter(w => w.length > 2 && !stopWords.has(w));

  // Busquem per nom (Firestore no té full-text, però podem fer array-contains-any si tenim un camp indexat)
  // Alternativa: buscar per les primeres lletres amb range query
  const resultats = [];

  for (const paraula of paraules.slice(0, 3)) { // Màxim 3 paraules per evitar moltes queries
    const snap = await db.collection('cercavins')
      .orderBy('nom')
      .startAt(paraula.charAt(0).toUpperCase() + paraula.slice(1))
      .endAt(paraula.charAt(0).toUpperCase() + paraula.slice(1) + '\uf8ff')
      .limit(5)
      .get();

    snap.docs.forEach(doc => {
      const d = doc.data();
      if (!resultats.find(r => r.nom === d.nom)) {
        resultats.push(mapVi(d));
      }
    });
  }

  // Si no trobem res per nom, fem una cerca general i deixem que la IA triï
  if (resultats.length === 0) {
    const fallback = await db.collection('cercavins').limit(10).get();
    fallback.docs.forEach(doc => resultats.push(mapVi(doc.data())));
  }

  return resultats.slice(0, 10);
}

async function buscarVinsPerMaridatge(pregunta) {
  const text = pregunta.toLowerCase();

  // Determinem quin tipus de vi és més adequat
  const voldríaBlanc = text.includes('peix') || text.includes('marisc') || text.includes('gamb') ||
    text.includes('percebe') || text.includes('ostr') || text.includes('musclo') ||
    text.includes('bacallà') || text.includes('salmó') || text.includes('blanc') ||
    text.includes('suau') || text.includes('lleuger');

  const voldriaEspumós = text.includes('espumós') || text.includes('cava') ||
    text.includes('celebrar') || text.includes('aperitiu');

  const voldriaNegre = text.includes('carn') || text.includes('vedella') || text.includes('xai') ||
    text.includes('conill') || text.includes('costell') || text.includes('porc') ||
    text.includes('foie') || text.includes('trufa');

  // Query condicionada: evitem múltiples queries innecessàries
  let query = db.collection('cercavins');

  if (voldríaBlanc) query = query.where('tipus', '==', 'Blanc');
  else if (voldriaEspumós) query = query.where('tipus', '==', 'Espumós');
  else if (voldriaNegre) query = query.where('tipus', '==', 'Negre');
  // Si no hi ha preferència clara, no filtrem per tipus

  const snap = await query.limit(MAX_VINS_CONTEXT).get();
  return snap.docs.map(doc => mapVi(doc.data())).filter(v => v.imatge);
}

async function buscarVinsPerPlat(pregunta) {
  // Per plats típics necessitem varietat: blancs, negres i rosats
  const [blancsSnap, negresSnap] = await Promise.all([
    db.collection('cercavins').where('tipus', '==', 'Blanc').limit(8).get(),
    db.collection('cercavins').where('tipus', '==', 'Negre').limit(8).get(),
  ]);

  const vins = [
    ...blancsSnap.docs.map(d => mapVi(d.data())),
    ...negresSnap.docs.map(d => mapVi(d.data())),
  ].filter(v => v.imatge);

  return vins.slice(0, MAX_VINS_CONTEXT);
}

// ─── 3. MAPPER DE DADES ───────────────────────────────────────────────────────
function mapVi(d) {
  return {
    nom: d.nom || '',
    do: d.do || '',
    tipus: d.tipus || '',
    varietat: d.varietat || '',
    preu: d.preu || null,
    descripcio: d.descripcio || '',
    imatge: d.imatge || '',
    maridatge: d.maridatge || '',
  };
}

// ─── 4. PROMPTS PER INTENCIÓ ──────────────────────────────────────────────────
function buildPrompt(intencio, idioma, vins, pregunta) {
  const base = `Ets un sommelier expert. Respon SEMPRE en ${idioma}. Respon ÚNICAMENT amb JSON vàlid, sense text fora del JSON.`;

  const vinsList = JSON.stringify(
    vins.map(v => ({
      nom: v.nom,
      do: v.do,
      tipus: v.tipus,
      varietat: v.varietat,
      descripcio: v.descripcio,
      maridatge: v.maridatge,
      preu: v.preu,
      imatge: v.imatge,
    }))
  );

  if (intencio === 'vi') {
    return {
      system: `${base}
      
L'usuari pregunta per un vi concret. La teva tasca:
1. Identifica el vi a la llista que millor coincideix amb la consulta.
2. Fes una descripció experta d'unes 150 paraules: DO, varietat, notes de tast, temperatura de servei, potencial d'envelliment.
3. Suggereix 2 plats amb els quals marida bé.

FORMAT DE RESPOSTA (JSON estricte):
{
  "tipus_resposta": "vi",
  "vi_principal": {
    "nom": "...",
    "imatge": "...",
    "do": "...",
    "tipus": "...",
    "varietat": "..."
  },
  "descripcio": "text expert de 150 paraules en ${idioma}",
  "maridatge_suggerit": ["plat 1", "plat 2"]
}`,
      user: `Llista de vins disponibles: ${vinsList}\n\nConsulta de l'usuari: "${pregunta}"`,
    };
  }

  if (intencio === 'plat') {
    return {
      system: `${base}

L'usuari pregunta per un plat típic. La teva tasca:
1. Explica breument el plat (origen, ingredients principals, textura, sabor) en 80 paraules.
2. Tria EXACTAMENT 3 vins de la llista que maridin perfectament, justificant cada elecció.

FORMAT DE RESPOSTA (JSON estricte):
{
  "tipus_resposta": "plat",
  "plat": {
    "nom": "...",
    "descripcio": "descripció breu del plat en ${idioma}"
  },
  "vins_recomanats": [
    { "nom": "...", "imatge": "...", "do": "...", "justificacio": "per què marida (1 frase)" },
    { "nom": "...", "imatge": "...", "do": "...", "justificacio": "per què marida (1 frase)" },
    { "nom": "...", "imatge": "...", "do": "...", "justificacio": "per què marida (1 frase)" }
  ]
}`,
      user: `Llista de vins disponibles: ${vinsList}\n\nConsulta de l'usuari: "${pregunta}"`,
    };
  }

  // Maridatge directe (default)
  return {
    system: `${base}

L'usuari demana recomanació de maridatge. La teva tasca:
1. Analitza la consulta i tria EXACTAMENT 3 vins de la llista.
2. Per a cada vi escriu una justificació experta d'1-2 frases.
3. Afegeix un consell de sommelier al final (màx. 50 paraules).

FORMAT DE RESPOSTA (JSON estricte):
{
  "tipus_resposta": "maridatge",
  "introduccio": "frase introductòria experta en ${idioma}",
  "vins_recomanats": [
    { "nom": "...", "imatge": "...", "do": "...", "justificacio": "justificació experta en ${idioma}" },
    { "nom": "...", "imatge": "...", "do": "...", "justificacio": "justificació experta en ${idioma}" },
    { "nom": "...", "imatge": "...", "do": "...", "justificacio": "justificació experta en ${idioma}" }
  ],
  "consell_sommelier": "consell final en ${idioma}"
}`,
    user: `Llista de vins disponibles: ${vinsList}\n\nConsulta de l'usuari: "${pregunta}"`,
  };
}

// ─── 5. CRIDA A GROQ ──────────────────────────────────────────────────────────
async function cridarGroq(systemPrompt, userPrompt) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 800,
    }),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Groq error ${resp.status}: ${err}`);
  }

  const data = await resp.json();
  return JSON.parse(data.choices[0].message.content);
}

// ─── 6. POST-PROCÉS: garanteix que les imatges venen de la BD ────────────────
function reconciliarImatges(resultatIA, vinsDisponibles) {
  const lookup = {};
  vinsDisponibles.forEach(v => {
    lookup[v.nom] = v.imatge;
  });

  if (resultatIA.vi_principal) {
    resultatIA.vi_principal.imatge = lookup[resultatIA.vi_principal.nom] || '';
  }

  if (Array.isArray(resultatIA.vins_recomanats)) {
    resultatIA.vins_recomanats = resultatIA.vins_recomanats.map(v => ({
      ...v,
      imatge: lookup[v.nom] || '',
    }));
  }

  return resultatIA;
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
    // Pas 1: Detectar intenció (gratuït, instantani)
    const intencio = detectarIntencio(pregunta);

    // Pas 2: Query Firebase adaptada a la intenció (1 sola query o 2 en paral·lel com a màxim)
    let vins;
    if (intencio === 'vi') {
      vins = await buscarViConcret(pregunta);
    } else if (intencio === 'plat') {
      vins = await buscarVinsPerPlat(pregunta);
    } else {
      vins = await buscarVinsPerMaridatge(pregunta);
    }

    if (!vins || vins.length === 0) {
      return res.status(200).json({
        resposta: null,
        error: 'No hem trobat vins a la base de dades per a aquesta consulta.',
      });
    }

    // Pas 3: Construir el prompt adequat i cridar Groq
    const { system, user } = buildPrompt(intencio, idiomaReal, vins, pregunta);
    let resultat = await cridarGroq(system, user);

    // Pas 4: Reconciliar imatges (seguretat: imatges sempre de la BD, mai inventades)
    resultat = reconciliarImatges(resultat, vins);

    // Pas 5: Resposta estructurada al frontend
    return res.status(200).json({ resposta: resultat });

  } catch (error) {
    console.error('[sommelier] Error:', error);
    return res.status(500).json({
      resposta: null,
      error: 'El sommelier està seleccionant la millor ampolla. Torna a intentar-ho.',
    });
  }
};
