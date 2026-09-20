const express = require('express');
const crypto = require('crypto');

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

// ============================================================
// ROTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {
    res.status(200).send('Xablau Store Webhook Online');
});

// ============================================================
// WEBHOOK MERCADO PAGO
// ============================================================

app.post('/webhook/mercadopago', (req, res) => {

    // Responde rapidamente ao Mercado Pago.
    res.sendStatus(200);

    try {

        console.log('');
        console.log('======================================');
        console.log('🔔 NOTIFICAÇÃO MERCADO PAGO');
        console.log('======================================');

        console.log(
            JSON.stringify(req.body, null, 2)
        );

        console.log('======================================');
        console.log('');

    } catch (erro) {

        console.error(
            '❌ Erro processando webhook:',
            erro
        );

    }

});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(PORT, '0.0.0.0', () => {

    console.log('');
    console.log('======================================');
    console.log('       XABLAU STORE WEBHOOK');
    console.log('======================================');
    console.log(`Servidor iniciado na porta ${PORT}`);
    console.log('Aguardando notificações do Mercado Pago...');
    console.log('======================================');
    console.log('');

});
