// Kripke model JSON -> nuXmv SMV converter.
//
// Exit codes: 0 ok, 1 invalid model, 2 I/O error.

#include <algorithm>
#include <fstream>
#include <iostream>
#include <map>
#include <regex>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include <nlohmann/json.hpp>

using json = nlohmann::json;

// Ordered containers throughout: the emitted SMV must be byte-identical
// across standard library implementations, and unordered_* iteration order
// is unspecified.
struct ModelKripke {
    std::vector<std::string> states;
    std::vector<std::string> initial_states;
    std::vector<std::pair<std::string, std::string>> transitions;
    std::map<std::string, std::vector<std::string>> state_predicates;
    std::vector<std::string> specifications;
    std::vector<std::string> fairness;
};

class ModelError : public std::runtime_error {
public:
    explicit ModelError(const std::string& what) : std::runtime_error(what) {}
};

// Mirrors $defs/identifier in schemas/kripke.schema.json. Kept here as well
// because the converter is the sandbox boundary: it must not emit malformed
// SMV even when invoked without the Python validator in front of it.
static const std::regex kIdentifier("^[A-Za-z_][A-Za-z0-9_$#-]*$");

static const std::set<std::string> kReserved = {
    "state_", "MODULE", "VAR", "IVAR", "FROZENVAR", "DEFINE", "ASSIGN",
    "INIT", "TRANS", "INVAR", "SPEC", "CTLSPEC", "LTLSPEC", "INVARSPEC",
    "PSLSPEC", "COMPUTE", "FAIRNESS", "JUSTICE", "COMPASSION", "CONSTANTS",
    "ISA", "case", "esac", "init", "next", "self", "boolean", "array",
    "of", "mod", "union", "in", "TRUE", "FALSE", "process", "main",
};

static void requireIdentifier(const std::string& name, const char* where) {
    if (!std::regex_match(name, kIdentifier))
        throw ModelError(std::string(where) + ": '" + name +
                         "' is not a valid SMV identifier");
    if (kReserved.count(name))
        throw ModelError(std::string(where) + ": '" + name +
                         "' is a reserved SMV identifier");
}

static std::string join(const std::vector<std::string>& xs,
                        const std::string& sep) {
    std::string out;
    for (size_t i = 0; i < xs.size(); ++i) {
        out += xs[i];
        if (i + 1 < xs.size()) out += sep;
    }
    return out;
}

static const json& require(const json& data, const char* key) {
    auto it = data.find(key);
    if (it == data.end())
        throw ModelError(std::string("missing required key '") + key + "'");
    if (!it->is_array())
        throw ModelError(std::string("key '") + key + "' must be an array");
    return *it;
}

ModelKripke parseModel(const std::string& filename) {
    std::ifstream file(filename);
    if (!file)
        throw std::ios_base::failure("cannot open " + filename);

    json data;
    try {
        data = json::parse(file);
    } catch (const json::parse_error& e) {
        throw ModelError(std::string("malformed JSON: ") + e.what());
    }
    if (!data.is_object())
        throw ModelError("top level value must be an object");

    ModelKripke model;

    for (const auto& s : require(data, "states")) {
        std::string name = s.get<std::string>();
        requireIdentifier(name, "states");
        model.states.push_back(std::move(name));
    }
    if (model.states.empty())
        throw ModelError("'states' must not be empty");

    std::set<std::string> known(model.states.begin(), model.states.end());
    if (known.size() != model.states.size())
        throw ModelError("duplicate entries in 'states'");

    for (const auto& i : require(data, "initial_states")) {
        std::string name = i.get<std::string>();
        if (!known.count(name))
            throw ModelError("initial state '" + name + "' is not declared");
        model.initial_states.push_back(std::move(name));
    }
    if (model.initial_states.empty())
        throw ModelError("'initial_states' must not be empty");

    for (const auto& t : require(data, "transitions")) {
        if (!t.is_array() || t.size() != 2)
            throw ModelError("each transition must be a pair of states");
        std::string from = t[0].get<std::string>();
        std::string to = t[1].get<std::string>();
        if (!known.count(from))
            throw ModelError("transition from unknown state '" + from + "'");
        if (!known.count(to))
            throw ModelError("transition to unknown state '" + to + "'");
        model.transitions.emplace_back(std::move(from), std::move(to));
    }

    for (const auto& sp : require(data, "state_predicates")) {
        if (!sp.is_object() || !sp.contains("state"))
            throw ModelError("each state_predicates entry needs a 'state'");
        std::string state = sp["state"].get<std::string>();
        if (!known.count(state))
            throw ModelError("predicates for unknown state '" + state + "'");
        if (model.state_predicates.count(state))
            throw ModelError("duplicate predicate entry for '" + state + "'");

        std::vector<std::string> preds;
        if (sp.contains("predicates")) {
            for (const auto& p : sp["predicates"]) {
                std::string name = p.get<std::string>();
                if (name.empty()) continue;
                requireIdentifier(name, "predicates");
                if (known.count(name))
                    throw ModelError("'" + name +
                                     "' is used as both a state and a predicate");
                preds.push_back(std::move(name));
            }
        }
        model.state_predicates[state] = std::move(preds);
    }

    if (data.contains("specifications"))
        for (const auto& s : data["specifications"])
            model.specifications.push_back(s.get<std::string>());

    if (data.contains("fairness"))
        for (const auto& f : data["fairness"])
            model.fairness.push_back(f.get<std::string>());

    return model;
}

std::string generateSMV(const ModelKripke& model) {
    std::string smv;

    smv += "MODULE main\nVAR\n";
    smv += "\tstate_ : {" + join(model.states, ", ") + "};\n";

    std::set<std::string> all_preds;
    for (const auto& [st, ps] : model.state_predicates)
        for (const auto& p : ps)
            if (!p.empty()) all_preds.insert(p);

    for (const auto& p : all_preds)
        smv += "\t" + p + " : boolean;\n";

    if (!model.fairness.empty()) {
        smv += "\n";
        for (const auto& f : model.fairness)
            smv += "-- Fairness constraint\nFAIRNESS\n\t" + f + "\n";
    }

    smv += "\nASSIGN\n";
    if (model.initial_states.size() == 1)
        smv += "\tinit(state_) := " + model.initial_states[0] + ";\n";
    else
        smv += "\tinit(state_) := {" + join(model.initial_states, ", ") + "};\n";

    smv += "\tnext(state_) := case\n";

    std::map<std::string, std::set<std::string>> tmap;
    for (const auto& [fr, to] : model.transitions) tmap[fr].insert(to);

    for (const auto& st : model.states) {
        auto it = tmap.find(st);
        if (it == tmap.end()) continue;
        std::vector<std::string> succ(it->second.begin(), it->second.end());
        smv += "\t\t(state_ = " + st + ") : {" + join(succ, ", ") + "};\n";
    }
    // Fallback for states with no outgoing transition. Totality of the
    // relation is enforced by validate_model.py; for a valid Kripke model
    // this branch is unreachable and exists only to keep the case
    // expression exhaustive.
    smv += "\t\tTRUE: state_;\n\tesac;\n";

    smv += "\n-- Predicate definitions\n";
    for (const auto& pred : all_preds) {
        std::vector<std::string> holds;
        for (const auto& [st, ps] : model.state_predicates)
            if (std::find(ps.begin(), ps.end(), pred) != ps.end())
                holds.push_back("(state_ = " + st + ")");

        smv += "\t" + pred + " :=\n\t\tcase\n\t\t\t";
        smv += (holds.empty() ? "FALSE" : join(holds, " | "));
        smv += " : TRUE;\n\t\t\tTRUE : FALSE;\n\t\tesac;\n";
    }

    if (!model.specifications.empty()) {
        smv += "\n";
        for (const auto& sp : model.specifications)
            smv += "SPEC\n\t" + sp + "\n\n";
    }

    return smv;
}

int main(int argc, char* argv[]) {
    if (argc < 2 || argc > 3) {
        std::cerr << "usage: " << argv[0] << " MODEL.json [OUTPUT.smv]\n";
        return 2;
    }
    const std::string in = argv[1];
    const std::string out = (argc == 3) ? argv[2] : "output.smv";

    ModelKripke model;
    try {
        model = parseModel(in);
    } catch (const ModelError& e) {
        std::cerr << in << ": invalid model: " << e.what() << "\n";
        return 1;
    } catch (const json::exception& e) {
        std::cerr << in << ": invalid model: " << e.what() << "\n";
        return 1;
    } catch (const std::exception& e) {
        std::cerr << in << ": " << e.what() << "\n";
        return 2;
    }

    std::ofstream f(out);
    if (!f) {
        std::cerr << "cannot write " << out << "\n";
        return 2;
    }
    f << generateSMV(model);
    f.close();
    if (!f) {
        std::cerr << "write failed: " << out << "\n";
        return 2;
    }

    std::cout << "SMV file generated: " << out << "\n"
              << "States:         " << model.states.size() << "\n"
              << "Transitions:    " << model.transitions.size() << "\n"
              << "Specifications: " << model.specifications.size() << "\n"
              << "Fairness:       " << model.fairness.size() << "\n";
    return 0;
}
