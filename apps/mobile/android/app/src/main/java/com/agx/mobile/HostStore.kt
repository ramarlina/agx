package com.agx.mobile

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.util.UUID

@Serializable
data class Host(
    val id: String = UUID.randomUUID().toString(),
    val name: String,
    val url: String,
    val lastUsed: Long = 0L,
)

private val Context.dataStore by preferencesDataStore(name = "agx_hosts")
private val HOSTS_KEY = stringPreferencesKey("hosts_json")

class HostStore(private val context: Context) {
    val hosts: Flow<List<Host>> = context.dataStore.data.map { prefs ->
        prefs[HOSTS_KEY]?.let { Json.decodeFromString<List<Host>>(it) } ?: emptyList()
    }

    suspend fun upsert(host: Host) = mutate { list ->
        val idx = list.indexOfFirst { it.id == host.id }
        if (idx >= 0) list.toMutableList().also { it[idx] = host } else list + host
    }

    suspend fun delete(id: String) = mutate { list -> list.filterNot { it.id == id } }

    suspend fun touch(id: String) = mutate { list ->
        list.map { if (it.id == id) it.copy(lastUsed = System.currentTimeMillis()) else it }
    }

    private suspend fun mutate(block: (List<Host>) -> List<Host>) {
        context.dataStore.edit { prefs ->
            val current = prefs[HOSTS_KEY]?.let { Json.decodeFromString<List<Host>>(it) } ?: emptyList()
            prefs[HOSTS_KEY] = Json.encodeToString(kotlinx.serialization.builtins.ListSerializer(Host.serializer()), block(current))
        }
    }
}
