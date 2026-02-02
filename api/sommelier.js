const admin = require('firebase-admin');

module.exports = async (req, res) => {
    if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

    try {
        const { pregunta, idioma } = req.body;

        // 1. Detecció REAL de l'idioma enviat des del PC
        let llenguaResposta = "CATALÀ";
        if (idioma) {
            const lang = idioma.toLowerCase();
            if (lang.startsWith('es')) llenguaResposta = "CASTELLÀ (ESPAÑOL)";
            else if (lang.startsWith('fr')) llenguaResposta = "FRANCÈS (FRANÇAIS)";
            else if (lang.startsWith('en')) llenguaResposta = "ANGLÈS (ENGLISH)";
        }

        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId: process.env.FIREBASE_PROJECT_ID,
                    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
                    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n').trim(),
                }),
            });
        }

        const db = admin.firestore();
        const snapshot = await db.collection('cercavins').limit(40).get();
        let celler = [];

        snapshot.forEach(doc => {
            const d = doc.data();
            celler.push({ nom: d.nom, do: d.do, imatge: d.imatge, tipus: d.tipus });
        });

        // 2. El Prompt que obliga a la IA a buscar el raïm i parlar l'idioma del PC
        const responseIA = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.GROQ_API_KEY?.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'llama-3.3-70b-versatile',
                messages: [
                    {
                        role: 'system',
                        content: `Ets un Sommelier d'elit de Cercavins. 
                        
                        REGLA D'OR DE L'IDIOMA:
                        - Respon TOTALMENT i ÚNICAMENT en ${llenguaResposta}. 
                        - No usis frases en cap altre idioma.
                        
                        INSTRUCCIÓ DEL RAÏM (MEMÒRIA IA):
                        - Les dades del celler no tenen el camp 'raim'. TU els coneixes.
                        - Per a cada vi que recomanis, identifica el seu raïm (ex: Nerello Mascalese, Chardonnay, etc.) i explica per què és ideal per al plat.
                        - PROHIBIT dir "la lista no especifica la variedad".
                        
                        FORMAT:
                        - No usis asteriscs (*).
                        - Separa la teva explicació del JSON amb "|||".`
                    },
                    { role: 'user', content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
                ]
            })
        });

        const dataIA = await responseIA.json();
        res.status(200).json({ resposta: dataIA.choices[0].message.content });

    } catch (error) {
        res.status(500).json({ resposta: "Error: " + error.message });
    }
};
