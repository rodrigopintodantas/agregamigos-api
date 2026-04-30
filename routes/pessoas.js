const express = require("express");
const { sequelize, PessoaModel, EnderecoModel } = require("../models");
const { authBearerLogin } = require("../auth/authorize");

const router = express.Router();

function limparNumeros(value) {
  return value != null ? String(value).replace(/\D/g, "") : "";
}

router.get("/", authBearerLogin(), async (req, res, next) => {
  try {
    const pessoas = await PessoaModel.findAll({
      include: [{ model: EnderecoModel, required: false }],
      order: [["nome", "ASC"]],
    });
    return res.json(
      pessoas.map((p) => ({
        id: p.id,
        nome: p.nome,
        data_nascimento: p.dataNascimento ?? null,
        email: p.email ?? null,
        whatsapp: p.whatsapp ?? null,
        endereco: p.EnderecoModel
          ? {
              cep: p.EnderecoModel.cep ?? null,
              logradouro: p.EnderecoModel.logradouro ?? null,
              numero: p.EnderecoModel.numero ?? null,
              complemento: p.EnderecoModel.complemento ?? null,
              bairro: p.EnderecoModel.bairro ?? null,
              cidade: p.EnderecoModel.cidade ?? null,
              uf: p.EnderecoModel.uf ?? null,
              ibge: p.EnderecoModel.ibge ?? null,
            }
          : null,
      })),
    );
  } catch (err) {
    next(err);
  }
});

router.post("/", authBearerLogin(), async (req, res, next) => {
  try {
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const dataNascimento =
      req.body?.data_nascimento != null && String(req.body.data_nascimento).trim()
        ? String(req.body.data_nascimento).trim()
        : null;
    const email = req.body?.email != null ? String(req.body.email).trim().toLowerCase() : "";
    const whatsapp = req.body?.whatsapp != null ? String(req.body.whatsapp).trim() : "";
    const endereco = req.body?.endereco ?? {};

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return res.status(400).json({ message: "Data de nascimento inválida." });
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const created = await sequelize.transaction(async (transaction) => {
      const pessoa = await PessoaModel.create(
        {
          nome,
          dataNascimento,
          email: email || null,
          whatsapp: whatsapp || null,
        },
        { transaction },
      );

      await EnderecoModel.create(
        {
          PessoaModelId: pessoa.id,
          cep: cep || null,
          logradouro: endereco.logradouro ? String(endereco.logradouro).trim() : null,
          numero: endereco.numero ? String(endereco.numero).trim() : null,
          complemento: endereco.complemento ? String(endereco.complemento).trim() : null,
          bairro: endereco.bairro ? String(endereco.bairro).trim() : null,
          cidade: endereco.cidade ? String(endereco.cidade).trim() : null,
          uf,
          ibge: endereco.ibge ? String(endereco.ibge).trim() : null,
        },
        { transaction },
      );

      return pessoa;
    });

    return res.status(201).json({ id: created.id, message: "Pessoa cadastrada com sucesso." });
  } catch (err) {
    next(err);
  }
});

router.post("/link-cadastro", async (req, res, next) => {
  try {
    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const dataNascimento =
      req.body?.data_nascimento != null && String(req.body.data_nascimento).trim()
        ? String(req.body.data_nascimento).trim()
        : null;
    const email = req.body?.email != null ? String(req.body.email).trim().toLowerCase() : "";
    const whatsapp = req.body?.whatsapp != null ? String(req.body.whatsapp).trim() : "";
    const endereco = req.body?.endereco ?? {};

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return res.status(400).json({ message: "Data de nascimento inválida." });
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const created = await sequelize.transaction(async (transaction) => {
      const pessoa = await PessoaModel.create(
        {
          nome,
          dataNascimento,
          email: email || null,
          whatsapp: whatsapp || null,
        },
        { transaction },
      );

      await EnderecoModel.create(
        {
          PessoaModelId: pessoa.id,
          cep: cep || null,
          logradouro: endereco.logradouro ? String(endereco.logradouro).trim() : null,
          numero: endereco.numero ? String(endereco.numero).trim() : null,
          complemento: endereco.complemento ? String(endereco.complemento).trim() : null,
          bairro: endereco.bairro ? String(endereco.bairro).trim() : null,
          cidade: endereco.cidade ? String(endereco.cidade).trim() : null,
          uf,
          ibge: endereco.ibge ? String(endereco.ibge).trim() : null,
        },
        { transaction },
      );

      return pessoa;
    });

    return res.status(201).json({
      id: created.id,
      message: "Cadastro realizado com sucesso.",
    });
  } catch (err) {
    next(err);
  }
});

router.put("/:id", authBearerLogin(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID inválido." });
    }

    const nome = req.body?.nome != null ? String(req.body.nome).trim() : "";
    const dataNascimento =
      req.body?.data_nascimento != null && String(req.body.data_nascimento).trim()
        ? String(req.body.data_nascimento).trim()
        : null;
    const email = req.body?.email != null ? String(req.body.email).trim().toLowerCase() : "";
    const whatsapp = req.body?.whatsapp != null ? String(req.body.whatsapp).trim() : "";
    const endereco = req.body?.endereco ?? {};

    if (nome.length < 3) {
      return res.status(400).json({ message: "Informe nome com pelo menos 3 caracteres." });
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: "E-mail inválido." });
    }
    if (dataNascimento && !/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
      return res.status(400).json({ message: "Data de nascimento inválida." });
    }

    const cep = limparNumeros(endereco.cep || "").slice(0, 8);
    const uf = endereco.uf != null ? String(endereco.uf).trim().toUpperCase().slice(0, 2) : null;

    const updated = await sequelize.transaction(async (transaction) => {
      const pessoa = await PessoaModel.findByPk(id, { transaction });
      if (!pessoa) return null;

      await pessoa.update(
        {
          nome,
          dataNascimento,
          email: email || null,
          whatsapp: whatsapp || null,
        },
        { transaction },
      );

      const enderecoPayload = {
        cep: cep || null,
        logradouro: endereco.logradouro ? String(endereco.logradouro).trim() : null,
        numero: endereco.numero ? String(endereco.numero).trim() : null,
        complemento: endereco.complemento ? String(endereco.complemento).trim() : null,
        bairro: endereco.bairro ? String(endereco.bairro).trim() : null,
        cidade: endereco.cidade ? String(endereco.cidade).trim() : null,
        uf,
        ibge: endereco.ibge ? String(endereco.ibge).trim() : null,
      };

      const enderecoAtual = await EnderecoModel.findOne({
        where: { PessoaModelId: pessoa.id },
        transaction,
      });
      if (enderecoAtual) {
        await enderecoAtual.update(enderecoPayload, { transaction });
      } else {
        await EnderecoModel.create(
          {
            PessoaModelId: pessoa.id,
            ...enderecoPayload,
          },
          { transaction },
        );
      }

      return pessoa;
    });

    if (!updated) {
      return res.status(404).json({ message: "Pessoa não encontrada." });
    }

    return res.json({ message: "Pessoa atualizada com sucesso." });
  } catch (err) {
    next(err);
  }
});

router.delete("/:id", authBearerLogin(), async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "ID inválido." });
    }

    const deleted = await PessoaModel.destroy({ where: { id } });
    if (!deleted) {
      return res.status(404).json({ message: "Pessoa não encontrada." });
    }

    return res.json({ message: "Pessoa excluída com sucesso." });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
