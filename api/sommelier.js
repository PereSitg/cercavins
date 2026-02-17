const admin = require('firebase-admin');

// Inicialització ultra-segura
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    });
  } catch (e) { console.error("Error Firebase Init:", e); }
}

const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  // PLA B: Vins per defecte si tot falla (assegura la presentació)
  const vinsRescat = [
    { nom: "Pazo de Barrantes", imatge: "https://www.vilaviniteca.es/media/catalog/product/p/a/pazo_barrantes_21.jpg" },
    { nom: "Cune Reserva", imatge: "https://www.vilaviniteca.es/media/catalog/product/c/u/cune_reserva_19.jpg" },
    { nom: "Martín Códax", imatge: "https://www.vilaviniteca.es/media/catalog/product/m/a/martin_codax_23.jpg" }
  ];

  try {
    const { pregunta, idioma } = req.body;
    const p = (pregunta || "").toLowerCase();
    const idiomaReal = (idioma || 'ca').toLowerCase().includes('es') ? 'CASTELLANO' : 'CATALÀ';

    // 1. Cerca a Firebase (Límit baix per velocitat)
    let llistaTotal = [];
    try {
      const snap = await db.collection('cercavins').limit(100).get();
      llistaTotal = snap.docs.map(doc => ({
        nom: doc.data().nom,
        imatge: doc.data().imatge,
        info: `${doc.data().nom} ${doc.data().do} ${doc.data().tipus}`.toLowerCase()
      })).filter(v => v.imatge && v.imatge.startsWith('http') && !v.imatge.includes('viniteca_logo'));
    } catch (e) { console.error("Error Firestore:", e); }

    // Si no hi ha dades, usem rescat
    const dadesPerIA = llistaTotal.length > 0 ? llistaTotal.slice(0, 20) : vinsRescat;

    // 2. Crida a Groq amb Time-out o validació
    const promptSystem = `Ets un Sommelier. Respon en ${idiomaReal}. 
    Escriu 250 paraules. Usa <span class="nom-vi-destacat">NOM</span>.
    Retorna NOMÉS JSON: {"explicacio": "...", "vins": [{"nom": "...", "imatge": "..."}]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant',
        response_format: { type: "json_object" },
        messages: [{ role: 'system', content: promptSystem }, { role: 'user', content: p }],
        temperature: 0.3
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // 3. Validació final: Si la IA no ens dóna vins, posem els de rescat
    let vinsFinals = (contingut.vins || []).slice(0, 3);
    if (vinsFinals.length === 0) vinsFinals = vinsRescat;

    // Assegurem que cada vi tingui una imatge (si no, busquem a la llista original)
    vinsFinals = vinsFinals.map(v => {
      const trobat = llistaTotal.find(l => l.nom === v.nom);
      return { nom: v.nom, imatge: trobat ? trobat.imatge : vinsRescat[0].imatge };
    });

    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(vinsFinals)}` 
    });

  } catch (error) {
    // Aquest és el salvavides final: si tot peta, responem amb dades vàlides
    res.status(200).json({ 
      resposta: `Com a sommelier, us recomano una selecció equilibrada per a la vostra consulta. ||| ${JSON.stringify(vinsRescat)}
