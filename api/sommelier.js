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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

  try {
    const { pregunta, idioma } = req.body;
    const p = pregunta.toLowerCase();
    
    const langMap = { 'ca': 'CATALÀ', 'es': 'CASTELLANO', 'en': 'ENGLISH', 'fr': 'FRANÇAIS' };
    const idiomaReal = langMap[(idioma || 'ca').toLowerCase().slice(0, 2)] || 'CATALÀ';

    // 1. Cercar paraules clau per filtrar (raïm, regions, plat)
    const paraulesClau = p.split(/[ ,.!?]+/).filter(w => w.length > 3);

    // 2. Recuperació de vins reals (Límit alt per trobar coincidències)
    const [premSnap, econSnap] = await Promise.all([
      db.collection('cercavins').where('preu', '>', 35).limit(80).get(),
      db.collection('cercavins').where('preu', '>=', 7).where('preu', '<=', 18).limit(80).get()
    ]);

    const processarVins = (snap) => {
      return snap.docs
        .map(doc => {
          const d = doc.data();
          return { 
            nom: d.nom, 
            imatge: d.imatge, 
            do: d.do || "DO",
            info: `${d.nom} ${d.do} ${d.varietat || ''} ${d.tipus || ''}`.toLowerCase()
          };
        })
        .filter(v => {
          // FILTRE CRÍTIC: Només vins amb imatge i que no siguin Vila Viniteca
          if (!v.imatge || v.imatge.length < 10 || v.do === "Vila Viniteca") return false;
          
          if (paraulesClau.length === 0) return true;
          // Si busquem "percebes" (marisc), mirem si el vi és un blanc o encaixa amb la cerca
          const esBlanc = v.info.includes('blanc');
          return paraulesClau.some(clau => v.info.includes(clau)) || (p.includes('percebe') && esBlanc);
        })
        .sort(() => Math.random() - 0.5)
        .slice(0, 15);
    };

    const llistaAlta = processarVins(premSnap);
    const llistaEcon = processarVins(econSnap);

    // 3. PROMPT REFORÇAT PER EVITAR INVENCIONS
    const promptSystem = `Ets un Sommelier d'elit mundial. Respon en ${idiomaReal}. 
    
    INSTRUCCIÓ DE LONGITUD: Escriu una recomanació MAGISTRAL de unes 300 paraules. Sigues molt expert, parla de notes de tast, de la salinitat i de l'harmonia del maridatge. No siguis breu.
    
    REGLA D'OR PER A LES IMATGES: 
    - No inventis noms de vins ni varietats genèriques.
    - Tria exactament 3 vins dels que t'ofereixo al JSON de sota.
    - Has de copiar la URL del camp "imatge" exactament igual. Si no ho fas, les imatges no es veuran.

    FORMAT: Nom del vi en <span class="nom-vi-destacat"> i DO en <span class="text-destacat-groc">.

    VINS REALS DISPONIBLES:
    ${JSON.stringify({ alta_gama: llistaAlta, economics: llistaEcon })}

    JSON OBLIGATORI: {"explicacio": "Text llarg amb HTML...", "vins_triats": [{"nom": "...", "imatge": "..."}]}`;

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.1-8b-instant', 
        response_format: { type: "json_object" },
        messages: [
          { role: 'system', content: promptSystem },
          { role: 'user', content: `Pregunta del client: ${pregunta}` }
        ],
        temperature: 0.5
      })
    });

    const data = await groqResponse.json();
    const contingut = JSON.parse(data.choices[0].message.content);
    
    // Devolvim la resposta amb els 3 vins triats per la IA (que ara seran reals)
    res.status(200).json({ 
      resposta: `${contingut.explicacio} ||| ${JSON.stringify(contingut.vins_triats.slice(0, 3))}` 
    });

  } catch (error) {
    console.error("ERROR:", error.message);
    res.status(200).json({ 
      resposta: `El sommelier està seleccionant la millor ampolla. Torna-ho a provar en un moment. ||| []` 
    });
  }
};
