#include <iostream>
#include <fstream>
#include <string>
#include <vector>
#include <unordered_map>
#include <set>
#include <nlohmann/json.hpp>

using json = nlohmann::json;

struct ModelKripke {
    std::vector<std::string> states;
    std::vector<std::string> initial_states;
    std::vector<std::pair<std::string, std::string>> transitions;
    std::unordered_map<std::string, std::vector<std::string>> state_predicates;
    std::vector<std::string> specifications;
    std::vector<std::string> fairness;
};

ModelKripke parseModel(const std::string& filename) {
    ModelKripke model;
    std::ifstream file(filename);
    json data = json::parse(file);

    for (const auto& s : data["states"])       model.states.push_back(s);
    for (const auto& i : data["initial_states"]) model.initial_states.push_back(i);
    for (const auto& t : data["transitions"])  model.transitions.emplace_back(t[0], t[1]);

    for (const auto& sp : data["state_predicates"]) {
        std::string state = sp["state"];
        std::vector<std::string> preds;
        for (const auto& p : sp["predicates"])
            if (!p.empty()) preds.push_back(p);
        model.state_predicates[state] = preds;
    }

    if (data.contains("specifications"))
        for (const auto& s : data["specifications"]) model.specifications.push_back(s);

    if (data.contains("fairness"))
        for (const auto& f : data["fairness"])       model.fairness.push_back(f);

    return model;
}

std::string generateSMV(const ModelKripke& model) {
    std::string smv;

    smv += "MODULE main\nVAR\n";
    smv += "\tstate_ : {";
    for (size_t i = 0; i < model.states.size(); ++i) {
        smv += model.states[i];
        if (i + 1 < model.states.size()) smv += ", ";
    }
    smv += "};\n";

    std::set<std::string> all_preds;
    for (const auto& [st, ps] : model.state_predicates)
        for (const auto& p : ps) if (!p.empty()) all_preds.insert(p);

    for (const auto& p : all_preds)
        smv += "\t" + p + " : boolean;\n";

    if (!model.fairness.empty()) {
        smv += "\n";
        for (const auto& f : model.fairness)
            smv += "-- Fairness constraint\nFAIRNESS\n\t" + f + "\n";
    }

    smv += "\nASSIGN\n";
    smv += "\tinit(state_) := " + model.initial_states[0] + ";\n";
    smv += "\tnext(state_) := case\n";

    std::unordered_map<std::string, std::set<std::string>> tmap;
    for (const auto& [fr, to] : model.transitions) tmap[fr].insert(to);

    for (const auto& st : model.states) {
        if (tmap.count(st)) {
            smv += "\t\t(state_ = " + st + ") : {";
            size_t c = 0;
            for (const auto& t : tmap[st]) {
                smv += t;
                if (++c < tmap[st].size()) smv += ", ";
            }
            smv += "};\n";
        }
    }
    smv += "\t\tTRUE: state_;\n\tesac;\n";

    smv += "\n-- Predicate definitions\n";
    for (const auto& pred : all_preds) {
        smv += "\t" + pred + " :=\n\t\tcase\n\t\t\t";
        bool first = true;
        for (const auto& [st, ps] : model.state_predicates) {
            if (std::find(ps.begin(), ps.end(), pred) != ps.end()) {
                if (!first) smv += " | ";
                smv += "(state_ = " + st + ")";
                first = false;
            }
        }
        smv += (first ? "FALSE" : "") + std::string(" : TRUE;\n\t\t\tTRUE : FALSE;\n\t\tesac;\n");
    }

    if (!model.specifications.empty()) {
        smv += "\n";
        for (const auto& sp : model.specifications)
            smv += "SPEC\n\t" + sp + "\n\n";
    }

    return smv;
}

int main(int argc, char* argv[]) {
    std::string in  = (argc >= 2) ? argv[1] : "model.json";
    std::string out = (argc >= 3) ? argv[2] : "output.smv";

    ModelKripke model = parseModel(in);
    std::ofstream f(out);
    f << generateSMV(model);

    std::cout << "SMV file generated: " << out           << "\n"
              << "States:         "     << model.states.size()         << "\n"
              << "Transitions:    "     << model.transitions.size()    << "\n"
              << "Specifications: "     << model.specifications.size() << "\n"
              << "Fairness:       "     << model.fairness.size()       << "\n";
    return 0;
}
