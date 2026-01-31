export const config = {
  runtime: 'nodejs'
}

const admin = require('firebase-admin')
const fetch = require('node-fetch')

let db

if (!admin.apps.length) {
  try {
    const serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT
    )

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    })

    db = admin.firestore()
  } catch (error) {
    console.error('🔥 Error inicialitzant Firebase:', error)
  }
} else {
  db = admin.firestore()
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Mètode no permès' })
  }

  try {
    if (!db) {
      throw new Error('Firestore no inicialitzat')
    }

    const { pregunta } = req.body
    if (!pregunta) {
      return res.status(400).json({ error: 'Falta la pregunta' })
    }

    const snapshot = await db.collection('cercavins').get()

    let celler = 'Llista de vins de la base de dades:\n'
    snapshot.forEach(doc => {
      const d = doc.data()
      celler += `- ${d.nom} de la DO ${d.do}. Preu: ${d.preu}\n`
    })

    const response = await fetch(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            {
              role: 'system',
              content:
                `Ets el sommelier d'en Pere Badia. ` +
                `Aquests són els vins reals del celler:\n${celler}\n` +
                `Respon sempre en català de forma amable.`
            },
            { role: 'user', content: pregunta }
          ]
        })
      }
    )

    const data = await response.json()

    res.status(200).json({
      resposta: data.choices?.[0]?.message?.content ?? 'Sense resposta'
    })
  } catch (error) {
    console.error('❌ Error API:', error)
    res.status(500).json({ error: error.message })
  }
}
