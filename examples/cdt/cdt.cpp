#include <eosio/eosio.hpp>

#include <string>

using namespace eosio;

class [[eosio::contract]] cdt : public contract {
public:
   using contract::contract;

   struct [[eosio::table]] data {
      name        owner;
      int64_t     value;

      uint64_t primary_key() const { return owner.value; }
      uint64_t by_value() const { return (uint64_t)value; }
   };

   typedef multi_index<"data"_n, data,
      indexed_by<"byvalue"_n, const_mem_fun<data, uint64_t, &data::by_value>>
   > data_index;

   [[eosio::action]]
   void store(name owner, int64_t value)
   {
      require_auth(owner);

      // const char* messages are reported through eosio_assert
      check(value >= 0, "require non-negative value");
      // std::string messages are reported through eosio_assert_message
      check(value <= 100, std::string("value is out of range"));

      data_index di(get_self(), get_self().value);
      auto it = di.find(owner.value);

      if (it == di.end()) {
         di.emplace(owner, [&](auto& d) {
            d.owner = owner;
            d.value = value;
         });
      } else {
         di.modify(it, same_payer, [&](auto& d) {
            d.value = value;
         });
      }
   }

   // Action return values are serialized with set_action_return_value and
   // declared as action_results in the ABI, which CDT emits at version 1.2.
   [[eosio::action]]
   int64_t sum(int64_t a, int64_t b)
   {
      print(a + b);
      return a + b;
   }
};
