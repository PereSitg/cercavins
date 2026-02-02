const admin = require('firebase-admin');

module.exports = async (req, res) => {
    // Evitem mètodes que no siguin POST
    if (req.method !== 'POST') return res.status(405).send('Mètode no permès');

    try {
        const { pregunta, idioma } = req.body;

        // LOGICA D'IDIOMA: Forcem que la IA entengui l'ordre segons el PC
        let llenguaResposta = "CATALÀ";
        if (idioma) {
            const lang = idioma.toLowerCase();
            if (lang.startsWith('es')) llenguaResposta = "CASTELLÀ (ESPAÑOL)";
            else if (lang.startsWith('fr')) llenguaResposta = "FRANCÈS (FRANÇAIS)";
            else if (lang.startsWith('en')) llenguaResposta = "ANGLÈS (ENGLISH)";
        }

        // INICIALITZACIÓ FIREBASE
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
        // Reduïm a 20 vins per anar més ràpid i evitar el "Timeout" de Vercel
        const snapshot = await db.collection('cercavins').limit(20).get();
        let celler = [];

        snapshot.forEach(doc => {
            const d = doc.data();
            celler.push({ nom: d.nom, do: d.do, imatge: d.imatge, tipus: d.tipus });
        });

        // CRIDA A LA IA AMB PROMPT REFORÇAT
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
                        content: `Ets un Sommelier d'elit. 
                        REGLA 1: Respon ÚNICAMENT en ${llenguaResposta}. És vital.
                        REGLA 2: No tens el camp 'raim' a les dades, però TU saps de quin raïm està fet cada vi. Identifica'l i explica'l.
                        REGLA 3: PROHIBIT dir "la lista no especifica". Sigues un expert.
                        REGLA 4: Format net sense asteriscs. Separa amb |||.`
                    },
                    { role: 'user', content: `Celler: ${JSON.stringify(celler)}. Pregunta: ${pregunta}` }
                ],
                max_tokens: 800 // Limitem per evitar talls de connexió
            })
        });

        const dataIA = await responseIA.json();

        if (dataIA.choices && dataIA.choices[0]) {
            return res.status(200).json({ resposta: dataIA.choices[0].message.content });
        } else {
            return res.status(500).json({ resposta: "La IA ha trigat massa o no ha respost." });
        }

    } catch (error) {
        console.error("Error detectat:", error.message);
        return res.status(500).json({ resposta: "Error de connexió: " + error.message });
    }
};
