const express = require('express');
const crypto = require('crypto');

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const MERCADO_PAGO_WEBHOOK_SECRET =
    process.env.MERCADO_PAGO_WEBHOOK_SECRET;

const MERCADO_PAGO_ACCESS_TOKEN =
    process.env.MERCADO_PAGO_ACCESS_TOKEN;

const BOT_WEBHOOK_SECRET =
    process.env.BOT_WEBHOOK_SECRET;

// ============================================================
// PRODUTOS
// ============================================================

const PRODUTOS = {
    windows: {
        nome: 'Windows Lifetime',
        preco: 30.00
    },

    otimizacao: {
        nome: 'Otimização de PC',
        preco: 20.00
    }
};

// ============================================================
// ROTA PRINCIPAL
// ============================================================

app.get('/', (req, res) => {

    res.status(200).send(
        'Xablau Store Webhook Online'
    );

});

// ============================================================
// PEGAR DATA ID
// ============================================================

function obterDataId(req) {

    const queryId =
        req.query?.['data.id'] ||
        req.query?.id;

    if (queryId) {
        return String(queryId);
    }

    const bodyId =
        req.body?.data?.id ||
        req.body?.id;

    if (bodyId) {
        return String(bodyId);
    }

    return null;
}

// ============================================================
// VALIDAR ASSINATURA MERCADO PAGO
// ============================================================

function validarAssinaturaMercadoPago(req) {

    if (!MERCADO_PAGO_WEBHOOK_SECRET) {
        console.error(
            '❌ MERCADO_PAGO_WEBHOOK_SECRET não configurado.'
        );

        return false;
    }

    const xSignature =
        req.headers['x-signature'];

    const xRequestId =
        req.headers['x-request-id'];

    const dataId =
        obterDataId(req);

    if (
        !xSignature ||
        !xRequestId ||
        !dataId
    ) {
        return false;
    }

    const partes = {};

    for (const parte of xSignature.split(',')) {

        const [chave, valor] =
            parte.split('=');

        if (chave && valor) {
            partes[chave.trim()] =
                valor.trim();
        }
    }

    const ts =
        partes.ts;

    const v1 =
        partes.v1;

    if (!ts || !v1) {
        return false;
    }

    const manifesto =
        `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const assinaturaEsperada =
        crypto
            .createHmac(
                'sha256',
                MERCADO_PAGO_WEBHOOK_SECRET
            )
            .update(manifesto)
            .digest('hex');

    try {

        const recebida =
            Buffer.from(
                v1,
                'hex'
            );

        const esperada =
            Buffer.from(
                assinaturaEsperada,
                'hex'
            );

        if (
            recebida.length !==
            esperada.length
        ) {
            return false;
        }

        return crypto.timingSafeEqual(
            recebida,
            esperada
        );

    } catch {
        return false;
    }
}

// ============================================================
// CONSULTAR ORDER NO MERCADO PAGO
// ============================================================

async function consultarOrder(orderId) {

    if (!MERCADO_PAGO_ACCESS_TOKEN) {

        throw new Error(
            'MERCADO_PAGO_ACCESS_TOKEN não configurado.'
        );
    }

    const resposta =
        await fetch(
            `https://api.mercadopago.com/v1/orders/${encodeURIComponent(orderId)}`,
            {
                method: 'GET',

                headers: {
                    Authorization:
                        `Bearer ${MERCADO_PAGO_ACCESS_TOKEN}`,

                    Accept:
                        'application/json'
                }
            }
        );

    let dados = null;

    try {
        dados =
            await resposta.json();
    } catch {}

    if (!resposta.ok) {

        const erro =
            new Error(
                `Mercado Pago HTTP ${resposta.status}`
            );

        erro.status =
            resposta.status;

        throw erro;
    }

    return dados;
}

// ============================================================
// ANALISAR ORDER
// ============================================================

function analisarOrder(order) {

    if (!order) {

        return {
            valida: false,
            aprovada: false,
            motivo: 'order_inexistente'
        };
    }

    const referencia =
        String(
            order.external_reference || ''
        );

    const match =
        referencia.match(
            /^(windows|otimizacao)_(\d+)_(\d+)$/
        );

    if (!match) {

        return {
            valida: false,
            aprovada: false,
            motivo: 'external_reference_invalida'
        };
    }

    const tipoProduto =
        match[1];

    const discordUserId =
        match[2];

    const timestamp =
        match[3];

    const produto =
        PRODUTOS[tipoProduto];

    if (!produto) {

        return {
            valida: false,
            aprovada: false,
            motivo: 'produto_invalido'
        };
    }

    const pagamento =
        order
            ?.transactions
            ?.payments?.[0];

    if (!pagamento) {

        return {
            valida: true,
            aprovada: false,
            motivo: 'pagamento_nao_encontrado',

            tipoProduto,
            discordUserId,
            timestamp
        };
    }

    const statusOrder =
        order?.status;

    const detalheOrder =
        order?.status_detail;

    const statusPagamento =
        pagamento?.status;

    const detalhePagamento =
        pagamento?.status_detail;

    const valorOrder =
        Number(
            order?.total_amount ?? 0
        );

    const valorPago =
        Number(
            order?.total_paid_amount ?? 0
        );

    const valorPagamento =
        Number(
            pagamento?.paid_amount ??
            pagamento?.amount ??
            0
        );

    const precoEsperado =
        Number(
            produto.preco
        );

    const valoresIguais =
        Math.abs(
            valorOrder -
            precoEsperado
        ) < 0.001 &&

        Math.abs(
            valorPago -
            precoEsperado
        ) < 0.001 &&

        Math.abs(
            valorPagamento -
            precoEsperado
        ) < 0.001;

    const orderProcessada =
        statusOrder ===
        'processed';

    const pagamentoProcessado =
        statusPagamento ===
        'processed';

    const pagamentoAcreditado =
        detalhePagamento ===
            'accredited' ||
        detalheOrder ===
            'accredited';

    const aprovada =
        orderProcessada &&
        pagamentoProcessado &&
        pagamentoAcreditado &&
        valoresIguais;

    let motivo =
        'aguardando_pagamento';

    if (aprovada) {

        motivo =
            'pagamento_aprovado';

    } else if (!valoresIguais) {

        motivo =
            'valor_incorreto';

    } else if (
        statusOrder === 'canceled' ||
        statusOrder === 'cancelled' ||
        statusOrder === 'failed' ||
        statusOrder === 'expired' ||
        statusPagamento === 'rejected' ||
        statusPagamento === 'cancelled' ||
        statusPagamento === 'canceled'
    ) {

        motivo =
            'pagamento_nao_aprovado';
    }

    return {
        valida: true,
        aprovada,
        motivo,

        orderId:
            String(order.id),

        tipoProduto,

        produto:
            produto.nome,

        discordUserId,

        timestamp,

        precoEsperado,

        statusOrder,

        detalheOrder,

        statusPagamento,

        detalhePagamento,

        valorOrder,

        valorPago,

        valorPagamento,

        externalReference:
            referencia
    };
}

// ============================================================
// AUTENTICAR BOT
// ============================================================

function autenticarBot(req, res, next) {

    if (!BOT_WEBHOOK_SECRET) {

        console.error(
            '❌ BOT_WEBHOOK_SECRET não configurado.'
        );

        return res
            .status(500)
            .json({
                erro:
                    'Servidor não configurado.'
            });
    }

    const authorization =
        req.headers.authorization;

    if (
        !authorization ||
        !authorization.startsWith(
            'Bearer '
        )
    ) {

        return res
            .status(401)
            .json({
                erro:
                    'Não autorizado.'
            });
    }

    const tokenRecebido =
        authorization
            .substring(7)
            .trim();

    try {

        const recebido =
            Buffer.from(
                tokenRecebido
            );

        const esperado =
            Buffer.from(
                BOT_WEBHOOK_SECRET
            );

        if (
            recebido.length !==
            esperado.length
        ) {

            return res
                .status(401)
                .json({
                    erro:
                        'Não autorizado.'
                });
        }

        if (
            !crypto.timingSafeEqual(
                recebido,
                esperado
            )
        ) {

            return res
                .status(401)
                .json({
                    erro:
                        'Não autorizado.'
                });
        }

    } catch {

        return res
            .status(401)
            .json({
                erro:
                    'Não autorizado.'
            });
    }

    next();
}

// ============================================================
// API PRIVADA PARA O BOT
// ============================================================

app.get(
    '/api/order/:orderId',
    autenticarBot,
    async (req, res) => {

        const orderId =
            String(
                req.params.orderId || ''
            ).trim();

        if (
            !/^[a-zA-Z0-9_-]+$/.test(
                orderId
            )
        ) {

            return res
                .status(400)
                .json({
                    erro:
                        'Order ID inválido.'
                });
        }

        try {

            const order =
                await consultarOrder(
                    orderId
                );

            const analise =
                analisarOrder(
                    order
                );

            return res
                .status(200)
                .json(analise);

        } catch (erro) {

            console.error(
                `❌ Erro consultando Order ${orderId}:`,
                erro.message
            );

            if (
                erro.status === 400 ||
                erro.status === 404
            ) {

                return res
                    .status(404)
                    .json({
                        erro:
                            'Order não encontrada.'
                    });
            }

            return res
                .status(503)
                .json({
                    erro:
                        'Não foi possível consultar a Order.'
                });
        }
    }
);

// ============================================================
// WEBHOOK MERCADO PAGO
// ============================================================

app.post(
    '/webhook/mercadopago',
    async (req, res) => {

        const assinaturaValida =
            validarAssinaturaMercadoPago(
                req
            );

        if (!assinaturaValida) {

            console.warn(
                '⚠️ Webhook recusado: assinatura inválida.'
            );

            return res
                .status(401)
                .send('Assinatura inválida');
        }

        const orderId =
            obterDataId(req);

        const acao =
            req.body?.action ||
            req.body?.type ||
            'desconhecida';

        console.log('');
        console.log(
            '🔔 WEBHOOK MERCADO PAGO AUTÊNTICO'
        );
        console.log(
            `Ação: ${acao}`
        );
        console.log(
            `Order ID: ${orderId}`
        );

        if (!orderId) {

            return res
                .status(200)
                .send('OK');
        }

        /*
         * Confirmamos rapidamente o recebimento.
         * O bot também consulta a API privada deste
         * servidor antes de realizar qualquer entrega.
         */
        res.status(200).send('OK');

        try {

            const order =
                await consultarOrder(
                    orderId
                );

            const analise =
                analisarOrder(
                    order
                );

            console.log(
                `Produto: ${
                    analise.produto ||
                    'não identificado'
                }`
            );

            console.log(
                `Status: ${
                    analise.statusOrder ||
                    'desconhecido'
                }`
            );

            if (analise.aprovada) {

                console.log(
                    '✅ PAGAMENTO REAL CONFIRMADO PELO WEBHOOK'
                );

                console.log(
                    `Order: ${analise.orderId}`
                );

                console.log(
                    `Produto: ${analise.produto}`
                );

                console.log(
                    `Valor validado: R$ ${Number(
                        analise.precoEsperado
                    ).toFixed(2)}`
                );

                console.log(
                    `Discord User ID: ${analise.discordUserId}`
                );

            } else {

                console.log(
                    `ℹ️ Order ainda não liberada para entrega: ${analise.motivo}`
                );
            }

        } catch (erro) {

            console.error(
                '❌ Não foi possível confirmar esta Order.'
            );

            console.error(
                erro.message
            );
        }
    }
);

// ============================================================
// ERRO 404
// ============================================================

app.use((req, res) => {

    res
        .status(404)
        .json({
            erro:
                'Rota não encontrada.'
        });

});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(
    PORT,
    () => {

        console.log('');
        console.log(
            '================================='
        );
        console.log(
            '       XABLAU STORE WEBHOOK'
        );
        console.log(
            '================================='
        );

        console.log(
            `Servidor online na porta ${PORT}`
        );

        console.log(
            `🔐 Assinatura Webhook: ${
                MERCADO_PAGO_WEBHOOK_SECRET
                    ? 'CONFIGURADA'
                    : 'NÃO CONFIGURADA'
            }`
        );

        console.log(
            `🔑 Mercado Pago API: ${
                MERCADO_PAGO_ACCESS_TOKEN
                    ? 'CONFIGURADA'
                    : 'NÃO CONFIGURADA'
            }`
        );

        console.log(
            `🤖 Comunicação com Bot: ${
                BOT_WEBHOOK_SECRET
                    ? 'CONFIGURADA'
                    : 'NÃO CONFIGURADA'
            }`
        );

        console.log(
            'Aguardando notificações do Mercado Pago...'
        );

        console.log(
            '================================='
        );
        console.log('');
    }
);
