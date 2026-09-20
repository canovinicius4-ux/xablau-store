const express = require('express');
const crypto = require('crypto');

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;
const WEBHOOK_SECRET = process.env.MERCADO_PAGO_WEBHOOK_SECRET;

// ============================================================
// VERIFICAR CONFIGURAÇÃO
// ============================================================

if (!WEBHOOK_SECRET) {
    console.error('');
    console.error('======================================');
    console.error('❌ ERRO DE CONFIGURAÇÃO');
    console.error('======================================');
    console.error('MERCADO_PAGO_WEBHOOK_SECRET não foi configurada.');
    console.error('Configure a variável no Render.');
    console.error('======================================');
    console.error('');
}

// ============================================================
// ROTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {
    res.status(200).send('Xablau Store Webhook Online');
});

// ============================================================
// FUNÇÃO PARA VALIDAR ASSINATURA DO MERCADO PAGO
// ============================================================

function validarAssinaturaMercadoPago(req) {
    try {
        if (!WEBHOOK_SECRET) {
            console.error('❌ Assinatura secreta não configurada.');
            return false;
        }

        const xSignature = req.get('x-signature');
        const xRequestId = req.get('x-request-id');

        // O Mercado Pago envia o ID do recurso como query parameter.
        // Exemplo:
        // ?data.id=ORD123&type=order
        let dataId = req.query['data.id'];

        if (!xSignature || !xRequestId || !dataId) {
            console.warn('⚠️ Webhook sem dados necessários para validação.');
            return false;
        }

        // Para notificações Order, o Mercado Pago orienta
        // utilizar data.id em letras minúsculas na validação.
        dataId = String(dataId).toLowerCase();

        let timestamp = null;
        let assinaturaRecebida = null;

        const partes = xSignature.split(',');

        for (const parte of partes) {
            const separador = parte.indexOf('=');

            if (separador === -1) {
                continue;
            }

            const chave = parte.substring(0, separador).trim();
            const valor = parte.substring(separador + 1).trim();

            if (chave === 'ts') {
                timestamp = valor;
            }

            if (chave === 'v1') {
                assinaturaRecebida = valor;
            }
        }

        if (!timestamp || !assinaturaRecebida) {
            console.warn('⚠️ x-signature inválido.');
            return false;
        }

        const manifest =
            `id:${dataId};request-id:${xRequestId};ts:${timestamp};`;

        const assinaturaCalculada = crypto
            .createHmac('sha256', WEBHOOK_SECRET)
            .update(manifest)
            .digest('hex');

        // Verifica se os hashes têm formato compatível.
        if (
            !/^[a-f0-9]{64}$/i.test(assinaturaRecebida) ||
            !/^[a-f0-9]{64}$/i.test(assinaturaCalculada)
        ) {
            console.warn('⚠️ Formato de assinatura inválido.');
            return false;
        }

        const recebidaBuffer = Buffer.from(
            assinaturaRecebida,
            'hex'
        );

        const calculadaBuffer = Buffer.from(
            assinaturaCalculada,
            'hex'
        );

        if (recebidaBuffer.length !== calculadaBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(
            recebidaBuffer,
            calculadaBuffer
        );

    } catch (erro) {
        console.error(
            '❌ Erro ao validar assinatura:',
            erro.message
        );

        return false;
    }
}

// ============================================================
// WEBHOOK MERCADO PAGO
// ============================================================

app.post('/webhook/mercadopago', (req, res) => {

    try {
        // ----------------------------------------------------
        // VALIDAR ASSINATURA
        // ----------------------------------------------------

        const assinaturaValida =
            validarAssinaturaMercadoPago(req);

        if (!assinaturaValida) {
            console.warn('');
            console.warn('======================================');
            console.warn('🚫 WEBHOOK REJEITADO');
            console.warn('Assinatura Mercado Pago inválida.');
            console.warn('======================================');
            console.warn('');

            return res.sendStatus(401);
        }

        // ----------------------------------------------------
        // WEBHOOK AUTÊNTICO
        // ----------------------------------------------------

        const tipo = req.body?.type;
        const acao = req.body?.action;

        const orderId =
            req.query['data.id'] ||
            req.body?.data?.id ||
            null;

        console.log('');
        console.log('======================================');
        console.log('🔔 WEBHOOK MERCADO PAGO AUTÊNTICO');
        console.log('======================================');
        console.log(`Tipo: ${tipo || 'não informado'}`);
        console.log(`Ação: ${acao || 'não informada'}`);
        console.log(`Order ID: ${orderId || 'não informado'}`);
        console.log('======================================');
        console.log('');

        // IMPORTANTE:
        // Ainda NÃO liberamos produto aqui.
        //
        // No próximo passo consultaremos a Order diretamente
        // na API do Mercado Pago e confirmaremos:
        //
        // - status real da Order
        // - status do pagamento
        // - valor pago
        // - external_reference
        //
        // Só depois disso o pedido poderá ser entregue.

        return res.sendStatus(200);

    } catch (erro) {
        console.error(
            '❌ Erro processando webhook:',
            erro
        );

        return res.sendStatus(500);
    }
});

// ============================================================
// ROTA NÃO ENCONTRADA
// ============================================================

app.use((req, res) => {
    res.status(404).send('Not Found');
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

    if (WEBHOOK_SECRET) {
        console.log('🔐 Assinatura Webhook: CONFIGURADA');
    } else {
        console.log('❌ Assinatura Webhook: NÃO CONFIGURADA');
    }

    console.log(
        'Aguardando notificações do Mercado Pago...'
    );

    console.log('======================================');
    console.log('');
});
