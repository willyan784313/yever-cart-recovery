require('dotenv').config();
const express = require('express');
const axios = require('axios');
const sqlite3 = require('sqlite3').verbose();
const bodyParser = require('body-parser');

const app = express();
app.use(bodyParser.json());
app.use(express.static('public'));

// Configurações
const YEVER_API_URL = 'https://api.yever.com.br/api/v1';
const YEVER_TOKEN = process.env.YEVER_TOKEN;
const PORT = process.env.PORT || 3000;

// Banco de Dados
const db = new sqlite3.Database('./yever.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS abandoned_carts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT UNIQUE,
    customer_email TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    products TEXT,
    price_total REAL,
    checkout_url TEXT,
    created_at TEXT,
    updated_at TEXT,
    last_step TEXT,
    status TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS pix_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_reference TEXT,
    customer_email TEXT,
    value REAL,
    description TEXT,
    pix_code TEXT,
    pix_url TEXT,
    created_at TEXT,
    status TEXT DEFAULT 'pending'
  )`);
});

// Rotas da API

// Webhook para receber notificações da Yever
app.post('/yever-webhook', (req, res) => {
  const { token, reference, customer, products, price_total, checkout_url, created_at, updated_at, last_step, order_status } = req.body;

  // Verificar token do webhook (deveria ser validado com o token configurado)
  if (!token) {
    return res.status(401).send('Token inválido');
  }

  // Salvar carrinho abandonado
  if (last_step && (!order_status || order_status === 'canceled')) {
    db.run(
      `INSERT OR REPLACE INTO abandoned_carts 
      (reference, customer_email, customer_name, customer_phone, products, price_total, checkout_url, created_at, updated_at, last_step, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reference,
        customer.email,
        customer.name,
        customer.phone,
        JSON.stringify(products),
        price_total,
        checkout_url,
        created_at,
        updated_at,
        last_step,
        order_status || 'abandoned'
      ],
      (err) => {
        if (err) console.error('Erro ao salvar carrinho:', err);
      }
    );
  }

  res.status(200).send('Webhook recebido');
});

// Rota para buscar carrinhos abandonados
app.get('/api/abandoned-carts', (req, res) => {
  db.all('SELECT * FROM abandoned_carts ORDER BY updated_at DESC', (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);
  });
});

// Rota para gerar PIX para um carrinho
app.post('/api/generate-pix', async (req, res) => {
  const { cart_id, description } = req.body;

  // Buscar carrinho no banco de dados
  db.get('SELECT * FROM abandoned_carts WHERE id = ?', [cart_id], async (err, cart) => {
    if (err || !cart) {
      return res.status(404).json({ error: 'Carrinho não encontrado' });
    }

    // Gerar PIX (simulação - na prática você usaria um gerador de PIX real)
    const pixCode = generatePixCode({
      chave: 'sua_chave_pix@email.com',
      valor: cart.price_total,
      descricao: description || `Pagamento carrinho ${cart.reference}`
    });

    // Salvar transação PIX
    db.run(
      `INSERT INTO pix_transactions 
      (order_reference, customer_email, value, description, pix_code, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [cart.reference, cart.customer_email, cart.price_total, description, pixCode],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        res.json({
          pix_code: pixCode,
          pix_url: `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(pixCode)}`,
          transaction_id: this.lastID
        });
      }
    );
  });
});

// Rota para consultar pedidos diretamente na API Yever
app.get('/api/yever-orders', async (req, res) => {
  try {
    const { status, page = 1, per_page = 100 } = req.query;
    
    const response = await axios.get(`${YEVER_API_URL}/order/list`, {
      headers: { Authorization: `Bearer ${YEVER_TOKEN}` },
      params: {
        status,
        page,
        per_page,
        updated_at_inicial: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      }
    });

    res.json(response.data);
  } catch (error) {
    console.error('Erro ao consultar API Yever:', error);
    res.status(500).json({ error: 'Erro ao consultar API Yever' });
  }
});

// Função auxiliar para gerar código PIX (simplificado)
function generatePixCode({ chave, valor, descricao }) {
  const payload = {
    chave,
    valor: valor.toFixed(2),
    descricao: descricao.substring(0, 140),
    txid: 'YV' + Math.random().toString(36).substring(2, 10)
  };
  
  return `00020126580014BR.GOV.BCB.PIX0136${payload.chave}520400005303986540${payload.valor}5802BR59${payload.descricao}60${payload.txid}6304`;
}

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
