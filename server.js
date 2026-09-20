const express = require('express');
const crypto = require('crypto');

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const WEBHOOK_SECRET =
    process.env.MERCADO_PAGO_WEBHOOK_SECRET;

const ACCESS_TOKEN =
    process.env.MERCADO_PAGO_ACCESS_TOKEN;

// ============================================================
// VERIFICAR CONFIGURAÇÃO
// ============================================================

if (!WEBHOOK_SECRET) {
    console.error('');
    console.error('======================================');
    console.error('❌ ERRO DE CONFIGURAÇÃO');
    console.error('======================================');
    console.error(
        'MERCADO_PAGO_WEBHOOK_SECRET não foi configurada.'
    );
    console.error('======================================');
    console.error('');
}

if (!ACCESS_TOKEN) {
    console.error('');
    console.error('======================================');
    console.error('❌ ERRO DE CONFIGURAÇÃO');
    console.error('======================================');
    console.error(
        'MERCADO_PAGO_ACCESS_TOKEN não foi configurado.'
    );
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
// PEGAR DATA.ID
// ============================================================

function obterDataId(req) {

    return (
        req.query['data.id'] ||
        req.body?.data?.id ||
        null
    );
}

// ============================================================
// VALIDAR ASSINATURA MERCADO PAGO
// ============================================================

function validarAssinaturaMercadoPago(req) {

    try {

        if (!WEBHOOK_SECRET) {
            console.error(
                '❌ Assinatura secreta não configurada.'
            );

            return false;
        }

        const xSignature =
            req.get('x-signature');

        const xRequestId =
            req.get('x-request-id');

        let dataId =
            obterDataId(req);

        if (
            !xSignature ||
            !xRequestId ||
            !dataId
        ) {
            console.warn(
                '⚠️ Webhook sem dados necessários para validação.'
            );

            return false;
        }

        dataId =
            String(dataId).toLowerCase();

        let timestamp = null;
        let assinaturaRecebida = null;

        const partes =
            xSignature.split(',');

        for (const parte of partes) {

            const separador =
                parte.indexOf('=');

            if (separador === -1) {
                continue;
            }

            const chave =
                parte
                    .substring(0, separador)
                    .trim();

            const valor =
                parte
                    .substring(separador + 1)
                    .trim();

            if (chave === 'ts') {
                timestamp = valor;
            }

            if (chave === 'v1') {
                assinaturaRecebida = valor;
            }
        }

        if (
            !timestamp ||
            !assinaturaRecebida
        ) {
            console.warn(
                '⚠️ x-signature inválido.'
            );

            return false;
        }

        const manifest =
            `id:${dataId};` +
            `request-id:${xRequestId};` +
            `ts:${timestamp};`;

        const assinaturaCalculada =
            crypto
                .createHmac(
                    'sha256',
                    WEBHOOK_SECRET
                )
                .update(manifest)
                .digest('hex');

        if (
            !/^[a-f0-9]{64}$/i.test(
                assinaturaRecebida
            ) ||
            !/^[a-f0-9]{64}$/i.test(
                assinaturaCalculada
            )
        ) {
            console.warn(
                '⚠️ Formato da assinatura inválido.'
            );

            return false;
        }

        const recebidaBuffer =
            Buffer.from(
                assinaturaRecebida,
                'hex'
            );

        const calculadaBuffer =
            Buffer.from(
                assinaturaCalculada,
                'hex'
            );

        if (
            recebidaBuffer.length !==
            calculadaBuffer.length
        ) {
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
// CONSULTAR ORDER DIRETAMENTE NO MERCADO PAGO
// ============================================================

async function consultarOrderMercadoPago(orderId) {

    if (!ACCESS_TOKEN) {
        throw new Error(
            'Access Token não configurado.'
        );
    }

    const url =
        `https://api.mercadopago.com/v1/orders/` +
        encodeURIComponent(orderId);

    const resposta =
        await fetch(
            url,
            {
                method: 'GET',

                headers: {
                    Authorization:
                        `Bearer ${ACCESS_TOKEN}`,

                    Accept:
                        'application/json'
                }
            }
        );

    let dados;

    try {
        dados = await resposta.json();
    } catch {
        dados = null;
    }

    if (!resposta.ok) {

        console.error(
            `❌ Mercado Pago respondeu HTTP ${resposta.status}`
        );

        throw new Error(
            `Falha ao consultar Order. HTTP ${resposta.status}`
        );
    }

    return dados;
}

// ============================================================
// ANALISAR PAGAMENTO
// ============================================================

function analisarPagamento(order) {

    const pagamentos =
        Array.isArray(
            order?.transactions?.payments
        )
            ? order.transactions.payments
            : [];

    const pagamentosAcreditados =
        pagamentos.filter(
            pagamento =>
                pagamento?.status ===
                    'processed' &&
                pagamento?.status_detail ===
                    'accredited'
        );

    const totalPago =
        Number(order?.total_paid_amount);

    const totalOrder =
        Number(order?.total_amount);

    const valorValido =
        Number.isFinite(totalPago) &&
        Number.isFinite(totalOrder) &&
        totalPago > 0 &&
        totalOrder > 0 &&
        Math.abs(
            totalPago - totalOrder
        ) < 0.001;

    const orderProcessada =
        order?.status === 'processed';

    const orderAcreditada =
        order?.status_detail ===
        'accredited';

    const possuiPagamentoAcreditado =
        pagamentosAcreditados.length > 0;

    const externalReference =
        typeof order?.external_reference ===
        'string'
            ? order.external_reference
            : '';

    const referenciaXablau =
        /^(windows|otimizacao)_\d+_\d+$/.test(
            externalReference
        );

    const pagamentoConfirmado =
        orderProcessada &&
        orderAcreditada &&
        possuiPagamentoAcreditado &&
        valorValido &&
        referenciaXablau;

    return {
        pagamentoConfirmado,
        orderProcessada,
        orderAcreditada,
        possuiPagamentoAcreditado,
        valorValido,
        referenciaXablau,
        totalOrder,
        totalPago,
        externalReference
    };
}

// ============================================================
// WEBHOOK MERCADO PAGO
// ============================================================

app.post(
    '/webhook/mercadopago',
    async (req, res) => {

        try {

            // ================================================
            // 1. VALIDAR ASSINATURA
            // ================================================

            const assinaturaValida =
                validarAssinaturaMercadoPago(req);

            if (!assinaturaValida) {

                console.warn('');
                console.warn(
                    '======================================'
                );
                console.warn(
                    '🚫 WEBHOOK REJEITADO'
                );
                console.warn(
                    'Assinatura Mercado Pago inválida.'
                );
                console.warn(
                    '======================================'
                );
                console.warn('');

                return res.sendStatus(401);
            }

            // ================================================
            // 2. OBTER ORDER ID
            // ================================================

            const orderId =
                obterDataId(req);

            if (!orderId) {

                console.warn(
                    '⚠️ Webhook sem Order ID.'
                );

                return res.sendStatus(400);
            }

            console.log('');
            console.log(
                '======================================'
            );
            console.log(
                '🔔 WEBHOOK MERCADO PAGO AUTÊNTICO'
            );
            console.log(
                '======================================'
            );
            console.log(
                `Ação: ${
                    req.body?.action ||
                    'não informada'
                }`
            );
            console.log(
                `Order ID: ${orderId}`
            );
            console.log(
                '======================================'
            );

            // ================================================
            // 3. CONSULTAR MERCADO PAGO
            // ================================================

            let order;

            try {

                order =
                    await consultarOrderMercadoPago(
                        orderId
                    );

            } catch (erro) {

                console.warn('');
                console.warn(
                    '⚠️ Não foi possível confirmar esta Order.'
                );
                console.warn(
                    erro.message
                );
                console.warn('');

                // A notificação foi recebida corretamente.
                // Não entregamos nada sem confirmação.
                return res.sendStatus(200);
            }

            // ================================================
            // 4. ANALISAR PAGAMENTO REAL
            // ================================================

            const resultado =
                analisarPagamento(order);

            console.log('');
            console.log(
                '======================================'
            );
            console.log(
                '🔎 VERIFICAÇÃO DA ORDER'
            );
            console.log(
                '======================================'
            );

            console.log(
                `Status: ${
                    order?.status ||
                    'não informado'
                }`
            );

            console.log(
                `Status detail: ${
                    order?.status_detail ||
                    'não informado'
                }`
            );

            console.log(
                `Valor da Order: ${
                    Number.isFinite(
                        resultado.totalOrder
                    )
                        ? `R$ ${resultado.totalOrder.toFixed(2)}`
                        : 'inválido'
                }`
            );

            console.log(
                `Valor pago: ${
                    Number.isFinite(
                        resultado.totalPago
                    )
                        ? `R$ ${resultado.totalPago.toFixed(2)}`
                        : 'inválido'
                }`
            );

            console.log(
                `External reference válida: ${
                    resultado.referenciaXablau
                        ? 'SIM'
                        : 'NÃO'
                }`
            );

            console.log(
                `Pagamento acreditado: ${
                    resultado.possuiPagamentoAcreditado
                        ? 'SIM'
                        : 'NÃO'
                }`
            );

            console.log(
                '======================================'
            );

            // ================================================
            // 5. PAGAMENTO CONFIRMADO
            // ================================================

            if (
                !resultado.pagamentoConfirmado
            ) {

                console.log('');
                console.log(
                    '⏳ PAGAMENTO NÃO CONFIRMADO'
                );
                console.log(
                    'Nenhum produto será entregue.'
                );
                console.log('');

                return res.sendStatus(200);
            }

            console.log('');
            console.log(
                '======================================'
            );
            console.log(
                '✅ PAGAMENTO REAL CONFIRMADO'
            );
            console.log(
                '======================================'
            );
            console.log(
                `Order ID: ${order.id}`
            );
            console.log(
                `Referência: ${resultado.externalReference}`
            );
            console.log(
                `Valor: R$ ${resultado.totalPago.toFixed(2)}`
            );
            console.log(
                '======================================'
            );
            console.log('');

            // IMPORTANTE:
            //
            // Ainda NÃO fazemos a entrega aqui.
            //
            // Neste ponto já temos:
            //
            // 1. Webhook autenticado
            // 2. Order consultada diretamente no Mercado Pago
            // 3. Order processada
            // 4. Status accredited
            // 5. Pagamento processado/acreditado
            // 6. Valor total conferido
            // 7. External reference da Xablau conferida
            //
            // O próximo passo será conectar esta confirmação
            // ao pedido correspondente do Discord.

            return res.sendStatus(200);

        } catch (erro) {

            console.error(
                '❌ Erro processando webhook:',
                erro
            );

            return res.sendStatus(500);
        }
    }
);

// ============================================================
// ROTA NÃO ENCONTRADA
// ============================================================

app.use((req, res) => {
    res.status(404).send('Not Found');
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================

app.listen(
    PORT,
    '0.0.0.0',
    () => {

        console.log('');
        console.log(
            '======================================'
        );
        console.log(
            '       XABLAU STORE WEBHOOK'
        );
        console.log(
            '======================================'
        );

        console.log(
            `Servidor iniciado na porta ${PORT}`
        );

        console.log(
            WEBHOOK_SECRET
                ? '🔐 Assinatura Webhook: CONFIGURADA'
                : '❌ Assinatura Webhook: NÃO CONFIGURADA'
        );

        console.log(
            ACCESS_TOKEN
                ? '🔑 Mercado Pago API: CONFIGURADA'
                : '❌ Mercado Pago API: NÃO CONFIGURADA'
        );

        console.log(
            'Aguardando notificações do Mercado Pago...'
        );

        console.log(
            '======================================'
        );
        console.log('');
    }
);
