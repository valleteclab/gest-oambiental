// Dados institucionais do produto (SaaS LicenciaGov – VALLETECLAB).
export const CONTATO_COMERCIAL = "loamesilva@valleteclab.com.br";
export const WHATSAPP_COMERCIAL = "5577998755764"; // (77) 99875-5764
export const MAILTO_DEMONSTRACAO = `mailto:${CONTATO_COMERCIAL}?subject=${encodeURIComponent("Demonstração do LicenciaGov")}`;
/** Abre a conversa no WhatsApp comercial com a mensagem já preenchida. */
export const WHATSAPP_DEMONSTRACAO = `https://wa.me/${WHATSAPP_COMERCIAL}?text=${encodeURIComponent(
  "Olá! Vi o site do LicenciaGov e gostaria de agendar uma demonstração para o meu município.",
)}`;
