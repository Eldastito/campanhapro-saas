/**
 * Email templates — Portuguese (Brasil), minimal HTML compatible with Gmail/Outlook/Apple Mail.
 *
 * Why inline styles: most email clients strip <style> blocks. Why no images:
 * keeps the template payload tiny and avoids "load images" prompts that hurt
 * deliverability.
 */

const APP_URL = process.env.APP_URL ?? 'http://localhost:3000';

function shell(title: string, body: string, footerNote = ''): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#222;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:540px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6ec;">
          <tr>
            <td style="padding:24px 28px 8px;">
              <p style="margin:0;font-size:13px;color:#6b6b75;letter-spacing:0.5px;">CAMPANHAPRO</p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;">
              ${body}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #f0f0f4;font-size:12px;color:#8b8b95;">
              ${footerNote || 'Você está recebendo este email porque é usuário do CampanhaPro.'}
              <br /><br />
              <span style="color:#aaaab2;">CampanhaPro · São Paulo, Brasil</span>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:24px 0;">
    <a href="${escapeAttr(href)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;">
      ${escapeHtml(label)}
    </a>
  </p>`;
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

const BRL = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ----- Templates -----

export const templates = {
  welcome(params: { name: string; campaignName: string }) {
    return {
      subject: `Bem-vindo ao CampanhaPro, ${params.name}!`,
      html: shell('Bem-vindo', `
        <h2 style="margin:0 0 8px;font-size:22px;color:#1a1a1f;">Bem-vindo, ${escapeHtml(params.name)}!</h2>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">
          Sua campanha <strong>${escapeHtml(params.campaignName)}</strong> está criada e pronta no plano <strong>Gratuito</strong>.
        </p>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">
          Você já tem acesso ao Dashboard e CRM. Para liberar agentes de IA, WhatsApp, simulações de cenários eleitorais e relatórios avançados, faça upgrade para Pro ou Enterprise direto na aba <strong>Plano</strong>.
        </p>
        ${button(`${APP_URL}/app`, 'Acessar minha campanha')}
        <p style="margin:0;font-size:13px;color:#6b6b75;">
          Precisa de ajuda? Responda este email — atendemos em até um dia útil.
        </p>
      `),
      text: `Bem-vindo, ${params.name}!\n\nSua campanha "${params.campaignName}" está criada no plano Gratuito.\n\nAcesse: ${APP_URL}/app`,
    };
  },

  paymentConfirmed(params: {
    name: string;
    planName: string;
    amountCents: number;
    paymentMethod: string;
  }) {
    const methodLabel: Record<string, string> = {
      pix: 'PIX', credit_card: 'cartão de crédito', debit_card: 'cartão de débito', boleto: 'boleto',
    };
    return {
      subject: `Pagamento confirmado — Plano ${params.planName}`,
      html: shell('Pagamento confirmado', `
        <h2 style="margin:0 0 8px;font-size:22px;color:#16a34a;">✓ Pagamento confirmado</h2>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
          Recebemos seu pagamento de <strong>${BRL(params.amountCents)}</strong> via ${methodLabel[params.paymentMethod] ?? params.paymentMethod}.
        </p>
        <div style="background:#f8f9fc;border-radius:8px;padding:14px 18px;margin:0 0 18px;font-size:14px;">
          <p style="margin:0 0 4px;color:#6b6b75;">Plano ativado</p>
          <p style="margin:0;font-size:18px;font-weight:700;color:#1a1a1f;">${escapeHtml(params.planName)}</p>
        </div>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">
          Todos os recursos do seu plano estão liberados imediatamente.
        </p>
        ${button(`${APP_URL}/app`, 'Acessar minha campanha')}
      `),
      text: `Pagamento confirmado: ${BRL(params.amountCents)} via ${params.paymentMethod}. Plano ${params.planName} ativado.`,
    };
  },

  paymentOverdue(params: { name: string; planName: string; amountCents: number }) {
    return {
      subject: 'Pagamento em atraso — sua assinatura',
      html: shell('Pagamento em atraso', `
        <h2 style="margin:0 0 8px;font-size:22px;color:#d97706;">Pagamento em atraso</h2>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
          Olá ${escapeHtml(params.name)}, identificamos que o pagamento de <strong>${BRL(params.amountCents)}</strong> do seu plano <strong>${escapeHtml(params.planName)}</strong> está em atraso.
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
          Para evitar a interrupção dos seus recursos, regularize o pagamento o quanto antes.
        </p>
        ${button(`${APP_URL}/app`, 'Regularizar pagamento')}
        <p style="margin:0;font-size:13px;color:#6b6b75;">
          Se já efetuou o pagamento, desconsidere este aviso — a confirmação pode levar até 2 dias úteis.
        </p>
      `),
      text: `Pagamento em atraso: ${BRL(params.amountCents)} - plano ${params.planName}.`,
    };
  },

  subscriptionCanceled(params: { name: string; planName: string; periodEnd: string }) {
    const date = new Date(params.periodEnd).toLocaleDateString('pt-BR');
    return {
      subject: 'Sua assinatura foi cancelada',
      html: shell('Assinatura cancelada', `
        <h2 style="margin:0 0 8px;font-size:22px;color:#1a1a1f;">Assinatura cancelada</h2>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">
          Olá ${escapeHtml(params.name)}, confirmamos o cancelamento da sua assinatura do plano <strong>${escapeHtml(params.planName)}</strong>.
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
          Você continua com acesso até <strong>${date}</strong>. Depois disso, a campanha volta ao plano Gratuito.
        </p>
        ${button(`${APP_URL}/app`, 'Reativar plano')}
        <p style="margin:0;font-size:13px;color:#6b6b75;">
          Mudou de ideia? Você pode reassinar a qualquer momento — seus dados permanecem intactos.
        </p>
      `),
      text: `Assinatura cancelada. Acesso ao plano ${params.planName} permanece até ${date}.`,
    };
  },

  teamInvite(params: { inviterName: string; campaignName: string; role: string; inviteUrl: string }) {
    return {
      subject: `${params.inviterName} convidou você para a campanha "${params.campaignName}"`,
      html: shell('Você foi convidado', `
        <h2 style="margin:0 0 8px;font-size:22px;color:#1a1a1f;">Você foi convidado para uma campanha</h2>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">
          <strong>${escapeHtml(params.inviterName)}</strong> está te convidando para participar da campanha
          <strong>${escapeHtml(params.campaignName)}</strong> como <strong>${escapeHtml(params.role)}</strong>.
        </p>
        ${button(params.inviteUrl, 'Aceitar convite')}
        <p style="margin:0;font-size:13px;color:#6b6b75;">
          Este convite expira em 7 dias. Se não foi você que esperava este email, ignore-o.
        </p>
      `),
      text: `${params.inviterName} convidou você para "${params.campaignName}" como ${params.role}. Aceite em: ${params.inviteUrl}`,
    };
  },

  dataConsentReminder(params: { name: string; campaignName: string }) {
    // LGPD-compliance reminder template — used when a user accesses their data
    return {
      subject: 'Sobre seus dados na campanha',
      html: shell('Aviso LGPD', `
        <h2 style="margin:0 0 8px;font-size:18px;color:#1a1a1f;">Aviso sobre seus dados (LGPD)</h2>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.55;">
          Olá ${escapeHtml(params.name)}, registramos um acesso aos seus dados pessoais na campanha
          <strong>${escapeHtml(params.campaignName)}</strong>.
        </p>
        <p style="margin:0 0 12px;font-size:14px;line-height:1.55;">
          Você tem direito a solicitar acesso, retificação ou exclusão dos seus dados a qualquer momento.
          Responda este email para falar com o Encarregado de Dados (DPO) da campanha.
        </p>
      `, 'Este email é parte do nosso compromisso com a Lei Geral de Proteção de Dados (Lei 13.709/2018).'),
      text: `Aviso LGPD — registramos acesso aos seus dados em "${params.campaignName}". Responda este email para falar com o DPO.`,
    };
  },

  paymentUpcoming(params: { name: string; planName: string; amountCents: number; daysUntilDue: number; dueDate: string }) {
    const dateStr = new Date(params.dueDate).toLocaleDateString('pt-BR');
    const when = params.daysUntilDue === 1 ? 'amanhã' : `em ${params.daysUntilDue} dias`;
    return {
      subject: `Sua próxima cobrança vence ${when}`,
      html: shell('Próxima cobrança', `
        <h2 style="margin:0 0 8px;font-size:22px;color:#1a1a1f;">Sua cobrança vence ${when}</h2>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
          Olá ${escapeHtml(params.name)}, é só um lembrete amigável: a próxima cobrança do plano <strong>${escapeHtml(params.planName)}</strong> no valor de <strong>${BRL(params.amountCents)}</strong> está prevista para <strong>${dateStr}</strong>.
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
          Se você paga via PIX ou boleto, garanta que o pagamento seja efetuado até a data acima para evitar interrupção dos seus recursos. Para cartão de crédito, a cobrança é automática.
        </p>
        ${button(`${APP_URL}/app`, 'Ver minha assinatura')}
      `),
      text: `Sua cobrança de ${BRL(params.amountCents)} do plano ${params.planName} vence em ${dateStr}.`,
    };
  },

  subscriptionDowngraded(params: { name: string; previousPlanName: string; gracePeriodDays: number }) {
    return {
      subject: 'Sua assinatura foi rebaixada para o plano Gratuito',
      html: shell('Assinatura rebaixada', `
        <h2 style="margin:0 0 8px;font-size:22px;color:#d97706;">Sua assinatura foi rebaixada</h2>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
          Olá ${escapeHtml(params.name)}, após ${params.gracePeriodDays} dias sem confirmação de pagamento, sua assinatura do plano <strong>${escapeHtml(params.previousPlanName)}</strong> foi rebaixada para o plano <strong>Gratuito</strong>.
        </p>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.55;">
          Seus dados estão intactos — você só perdeu acesso aos recursos exclusivos do plano pago. Para reativar todos os recursos, basta assinar novamente.
        </p>
        ${button(`${APP_URL}/app`, 'Reativar plano pago')}
        <p style="margin:0;font-size:13px;color:#6b6b75;">
          Se já efetuou o pagamento, entre em contato — responda este email.
        </p>
      `),
      text: `Sua assinatura do plano ${params.previousPlanName} foi rebaixada para Gratuito após ${params.gracePeriodDays} dias sem confirmação de pagamento. Reative em: ${APP_URL}/app`,
    };
  },
};
